package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"golang.org/x/time/rate"
)

var (
    port         = 3000
    ollamaHost   = "http://127.0.0.1:8080"
    modelName    = "qwen2:1.5b"
    systemPrompt = ""
)

type PromptRequest struct {
    Prompt  string    `json:"prompt"`
    History []Message `json:"history,omitempty"`
}

type Message struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

type Model struct {
    Name string `json:"name"`
}

type ModelsResponse struct {
    Models []Model `json:"models"`
}

type Server struct {
    limiter *rate.Limiter
}

func NewServer() *Server {
    return &Server{
        limiter: rate.NewLimiter(1, 5),
    }
}

func (s *Server) ensureModel() error {
    log.Println("Checking if model exists...")
    resp, err := http.Get(fmt.Sprintf("%s/api/tags", ollamaHost))
    if err != nil {
        return fmt.Errorf("could not fetch models: %v", err)
    }
    defer resp.Body.Close()

    var modelsResponse ModelsResponse
    if err := json.NewDecoder(resp.Body).Decode(&modelsResponse); err != nil {
        return fmt.Errorf("could not decode models response: %v", err)
    }

    modelExists := false
    for _, model := range modelsResponse.Models {
        if model.Name == modelName {
            modelExists = true
            break
        }
    }

    if modelExists {
        log.Println("Model already exists.")
        return nil
    }

    log.Println("Model does not exist. Pulling model...")
    payload := map[string]interface{}{
        "name":   modelName,
        "stream": true,
    }
    payloadBytes, err := json.Marshal(payload)
    if err != nil {
        return fmt.Errorf("could not marshal payload: %v", err)
    }

    resp, err = http.Post(fmt.Sprintf("%s/api/pull", ollamaHost), "application/json", bytes.NewBuffer(payloadBytes))
    if err != nil {
        return fmt.Errorf("could not pull model: %v", err)
    }
    defer resp.Body.Close()

    decoder := json.NewDecoder(resp.Body)
    for {
        var result map[string]interface{}
        if err := decoder.Decode(&result); err != nil {
            if err == io.EOF {
                break
            }
            return fmt.Errorf("could not decode pull model response: %v", err)
        }

        if status, ok := result["status"].(string); ok {
            log.Printf("Pull status: %s", status)
            if status == "success" {
                log.Println("Model pull succeeded.")
                return nil
            }
        } else {
            return fmt.Errorf("unexpected response structure: %v", result)
        }
    }

    return fmt.Errorf("model pull did not complete successfully")
}

func (s *Server) generateResponse(ctx context.Context, prompt string, history []Message) (chan string, error) {
    messages := []map[string]string{
        {"role": "system", "content": systemPrompt},
    }

    for _, msg := range history {
        messages = append(messages, map[string]string{"role": msg.Role, "content": msg.Content})
    }

    messages = append(messages, map[string]string{"role": "user", "content": prompt})

    payload := map[string]interface{}{
        "model":    modelName,
        "messages": messages,
        "stream":   true,
    }
    payloadBytes, err := json.Marshal(payload)
    if err != nil {
        return nil, fmt.Errorf("could not marshal payload: %v", err)
    }

    req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api/chat", ollamaHost), bytes.NewBuffer(payloadBytes))
    if err != nil {
        return nil, fmt.Errorf("could not create request: %v", err)
    }
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("could not post chat request: %v", err)
    }

    ch := make(chan string)
    go func() {
        defer close(ch)
        defer resp.Body.Close()

        decoder := json.NewDecoder(resp.Body)
        for {
            var msg map[string]interface{}
            if err := decoder.Decode(&msg); err != nil {
                if err == io.EOF {
                    break
                }
                ch <- fmt.Sprintf("Streaming error: %v", err)
                break
            }
            if content, ok := msg["message"].(map[string]interface{})["content"].(string); ok {
                ch <- content
            }
        }
    }()

    return ch, nil
}

func (s *Server) rateLimit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !s.limiter.Allow() {
            http.Error(w, "Too many requests", http.StatusTooManyRequests)
            return
        }

        next.ServeHTTP(w, r)
    })
}

func (s *Server) runModelHandler(w http.ResponseWriter, r *http.Request) {
    var req PromptRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "Bad vibes: Invalid request payload", http.StatusBadRequest)
        return
    }

    if req.Prompt == "" {
        http.Error(w, "Bad vibes: Prompt is required", http.StatusBadRequest)
        return
    }

    log.Println("Ensuring model is available...")
    if err := s.ensureModel(); err != nil {
        http.Error(w, fmt.Sprintf("Bad vibes: Failed to ensure model availability: %v", err), http.StatusInternalServerError)
        return
    }

    log.Println("Generating response...")
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
    defer cancel()

    ch, err := s.generateResponse(ctx, req.Prompt, req.History)
    if err != nil {
        http.Error(w, fmt.Sprintf("Bad vibes: Failed to run model: %v", err), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "text/plain")
    flusher, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "Bad vibes: Streaming unsupported", http.StatusInternalServerError)
        return
    }

    for msg := range ch {
        if _, err := w.Write([]byte(msg)); err != nil {
            log.Printf("Error writing message: %v", err)
            break
        }
        flusher.Flush()
    }
}

func main() {
    server := NewServer()

    log.Println("Ensuring model is available before starting server...")
    if err := server.ensureModel(); err != nil {
        log.Fatalf("Failed to ensure model availability: %v", err)
    }

    r := chi.NewRouter()

    corsHandler := cors.New(cors.Options{
        AllowedOrigins:   []string{"*"},
        AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
        AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
        ExposedHeaders:   []string{"Link"},
        AllowCredentials: true,
        MaxAge:           300,
    })
    r.Use(corsHandler.Handler)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(server.rateLimit)

    r.Post("/run-model", server.runModelHandler)

    srv := &http.Server{
        Addr:         fmt.Sprintf(":%d", port),
        Handler:      r,
        ReadTimeout:  20 * time.Second,
        WriteTimeout: 120 * time.Second,
        IdleTimeout:  30 * time.Second,
    }

    log.Printf("Starting server on :%d...\n", port)
    if err := srv.ListenAndServe(); err != nil {
        log.Fatalf("Server failed to start: %v", err)
    }
}
