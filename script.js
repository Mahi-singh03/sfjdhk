document.addEventListener('DOMContentLoaded', () => {
    const inputField = document.querySelector('input[type="text"]');
    const chatArea = document.querySelector('.chat-area');
    const sendIcon = document.querySelector('.send-icon i');
    const emojiButton = document.getElementById('emoji-button');
    const emojiPickerContainer = document.querySelector('.emoji-picker-container');
    const emojiPicker = document.querySelector('emoji-picker');

    // Your Gemini API key (replace with your actual key)
    const GEMINI_API_KEY = 'AIzaSyD4icgEVFlf6yToeBGP-3dB2buhs8hCNMM'; // Replace with your Gemini API key

    // Function to add a new message
    function addMessage(message, isSent = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
        
        const now = new Date();
        const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-content">
                <p>${message}</p>
                <span class="time">${time}</span>
            </div>
        `;
        
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    // Function to call Gemini API for response
    async function getGeminiResponse(message) {
        try {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: 'You are a helpful chatbot. Respond to the following message: ' + message }
                            ]
                        }
                    ],
                    generationConfig: {
                        maxOutputTokens: 150, // Adjust as needed
                        temperature: 0.7 // Controls response creativity
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text.trim();
        } catch (error) {
            console.error('Error fetching Gemini response:', error);
            return 'Sorry, something went wrong. Please try again.';
        }
    }

    // Function to handle sending messages
    async function sendMessage() {
        const message = inputField.value.trim();
        if (message) {
            addMessage(message); // Display user's message
            inputField.value = ''; // Clear input field
            sendIcon.className = 'fas fa-microphone'; // Reset to microphone icon

            // Get and display Gemini response
            const reply = await getGeminiResponse(message);
            addMessage(reply, false); // Display bot's response
        }
    }

    // Toggle emoji picker
    emojiButton.addEventListener('click', () => {
        emojiPickerContainer.classList.toggle('show');
    });

    // Handle emoji selection
    emojiPicker.addEventListener('emoji-click', event => {
        const cursorPosition = inputField.selectionStart;
        const text = inputField.value;
        const newText = text.slice(0, cursorPosition) + event.detail.unicode + text.slice(cursorPosition);
        inputField.value = newText;
        
        // Set cursor position after the inserted emoji
        const newPosition = cursorPosition + event.detail.unicode.length;
        inputField.setSelectionRange(newPosition, newPosition);
        inputField.focus();
    });

    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!emojiButton.contains(e.target) && !emojiPickerContainer.contains(e.target)) {
            emojiPickerContainer.classList.remove('show');
        }
    });

    // Event listeners
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    sendIcon.addEventListener('click', sendMessage);

    // Toggle between microphone and send icon
    inputField.addEventListener('input', () => {
        if (inputField.value.trim()) {
            sendIcon.className = 'fas fa-paper-plane';
        } else {
            sendIcon.className = 'fas fa-microphone';
        }
    });
});