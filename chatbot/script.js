const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-btn");
const stopButton = document.querySelector("#stop-btn");
const chatContainer = document.querySelector(".chat-container");
const themeButton = document.querySelector("#theme-btn");
const deleteButton = document.querySelector("#delete-btn");

let userText = null;
let stopRequested = false;

const loadDataFromLocalstorage = () => {
  const themeColor = localStorage.getItem("themeColor");

  document.body.classList.toggle("light-mode", themeColor === "light_mode");
  themeButton.innerText = document.body.classList.contains("light-mode")
    ? "dark_mode"
    : "light_mode";

  const defaultText = `<div class="default-text">
                            <h1>LaGazetteTulliste Intelligence</h1>
                            <p>Discutez avec l'IA Qwen2 sur nos serveurs. Votre historique reste local et non sauvegardé.</p>
                        </div>`;

  chatContainer.innerHTML = localStorage.getItem("all-chats") || defaultText;
  chatContainer.scrollTo(0, chatContainer.scrollHeight);
};

const createChatElement = (content, className) => {
  const chatDiv = document.createElement("div");
  chatDiv.classList.add("chat", className);
  chatDiv.innerHTML = content;
  return chatDiv;
};

const collectChatHistory = () => {
  const messages = [];
  chatContainer.querySelectorAll(".chat").forEach((chatDiv) => {
    const role = chatDiv.classList.contains("outgoing") ? "user" : "assistant";
    const content = chatDiv.querySelector("p")?.textContent || "";
    messages.push({ role, content });
  });
  return messages;
};

const getChatResponse = async (incomingChatDiv) => {
  const API_URL = "https://li.elliotmoreau.fr/run-model";
  const pElement = document.createElement("p");

  const chatHistory = collectChatHistory();
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: userText,
      history: chatHistory,
    }),
  };

  try {
    const response = await fetch(API_URL, requestOptions);
    if (!response.ok) {
      throw new Error(
        "Oups! Une erreur est survenue lors de la récupération de la réponse. Veuillez réessayer."
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    incomingChatDiv.querySelector(".typing-animation").remove();
    incomingChatDiv.querySelector(".chat-details").appendChild(pElement);

    readStream(reader, decoder, pElement);
  } catch (error) {
    stopButton.style.visibility = "hidden";
    sendButton.style.visibility = "visible";
    pElement.classList.add("error");
    pElement.textContent =
      "Oups! Une erreur est survenue lors de la récupération de la réponse. Veuillez réessayer.";
    incomingChatDiv.querySelector(".typing-animation").remove();
    incomingChatDiv.querySelector(".chat-details").appendChild(pElement);
    localStorage.setItem("all-chats", chatContainer.innerHTML);
    chatContainer.scrollTo(0, chatContainer.scrollHeight);
  }
};

const readStream = (reader, decoder, pElement) => {
  reader.read().then(({ done, value }) => {
    if (done || stopRequested) {
      stopButton.style.visibility = "hidden";
      pElement.innerHTML = parseMarkdown(pElement.textContent);
      sendButton.style.visibility = "visible";
      stopRequested = false;
      localStorage.setItem("all-chats", chatContainer.innerHTML);
      chatContainer.scrollTo(0, chatContainer.scrollHeight);
      return;
    }

    const text = decoder.decode(value, { stream: true });
    pElement.innerHTML += parseMarkdown(text);
    chatContainer.scrollTo(0, chatContainer.scrollHeight);
    readStream(reader, decoder, pElement);
  });
};

const copyResponse = (copyBtn) => {
  const reponseTextElement = copyBtn.parentElement.querySelector("p");
  navigator.clipboard.writeText(reponseTextElement.textContent);
  copyBtn.textContent = "done";
  setTimeout(() => (copyBtn.textContent = "content_copy"), 1000);
};

const parseMarkdown = (markdownText) => {
  // Code Blocks
  markdownText = markdownText.replace(
    /```([\s\S]*?)```/g,
    "<pre><code>$1</code></pre>"
  );
  // Titles
  markdownText = markdownText.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  markdownText = markdownText.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  markdownText = markdownText.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  markdownText = markdownText.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");
  markdownText = markdownText.replace(/^##### (.*?)$/gm, "<h5>$1</h5>");
  markdownText = markdownText.replace(/^###### (.*?)$/gm, "<h6>$1</h6>");
  // Bold
  markdownText = markdownText.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic
  markdownText = markdownText.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Inline Code
  markdownText = markdownText.replace(/`(.*?)`/g, "<code>$1</code>");
  // Link
  markdownText = markdownText.replace(
    /\[(.*?)\]\((.*?)\)/g,
    '<a href="$2">$1</a>'
  );
  // Horizontal Rule
  markdownText = markdownText.replace(/^---$/gm, "<hr>");
  // Line Break
  markdownText = markdownText.replace(/  \n/g, "<br>");
  return markdownText;
};

const showTypingAnimation = () => {
  const html = `<div class="chat-content">
                    <div class="chat-details">
                        <img src="img/chatbot.png" alt="chatbot-img">
                        <div class="typing-animation">
                            <div class="typing-dot" style="--delay: 0.2s"></div>
                            <div class="typing-dot" style="--delay: 0.3s"></div>
                            <div class="typing-dot" style="--delay: 0.4s"></div>
                        </div>
                    </div>
                    <span onclick="copyResponse(this)" class="material-symbols-rounded">content_copy</span>
                </div>`;
  const incomingChatDiv = createChatElement(html, "incoming");
  chatContainer.appendChild(incomingChatDiv);
  chatContainer.scrollTo(0, chatContainer.scrollHeight);
  getChatResponse(incomingChatDiv);
};

const handleOutgoingChat = () => {
  sendButton.style.visibility = "hidden";
  stopButton.style.visibility = "visible";
  userText = chatInput.value.trim();
  if (!userText) return;

  chatInput.value = "";

  const html = `<div class="chat-content">
                    <div class="chat-details">
                        <img src="img/user.png" alt="user-img" style="background-color: #000">
                        <p>${parseMarkdown(userText)}</p>
                    </div>
                </div>`;

  const outgoingChatDiv = createChatElement(html, "outgoing");
  chatContainer.querySelector(".default-text")?.remove();
  chatContainer.appendChild(outgoingChatDiv);
  chatContainer.scrollTo(0, chatContainer.scrollHeight);
  setTimeout(showTypingAnimation, 500);
};

stopButton.addEventListener("click", () => {
  stopRequested = true;
});

deleteButton.addEventListener("click", () => {
  if (confirm("Êtes-vous sûr de vouloir supprimer toutes les discussions ?")) {
    localStorage.removeItem("all-chats");
    loadDataFromLocalstorage();
  }
});

themeButton.addEventListener("click", () => {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("themeColor", themeButton.innerText);
  themeButton.innerText = document.body.classList.contains("dark-mode")
    ? "dark_mode"
    : "light_mode";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 800) {
    e.preventDefault();
    handleOutgoingChat();
  }
});

loadDataFromLocalstorage();
sendButton.addEventListener("click", handleOutgoingChat);
