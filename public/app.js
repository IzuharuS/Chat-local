(() => {
  const socket = io();

  // --- State ---
  let myIdentifier = '';
  let currentChat = null;

  // --- DOM refs ---
  const identityModal = document.getElementById('identity-modal');
  const identityInput = document.getElementById('identity-input');
  const identityBtn = document.getElementById('identity-btn');

  const app = document.getElementById('app');
  const userBadge = document.getElementById('user-badge');

  const newChatInput = document.getElementById('new-chat-input');
  const createChatBtn = document.getElementById('create-chat-btn');
  const chatList = document.getElementById('chat-list');

  const emptyState = document.getElementById('empty-state');
  const chatView = document.getElementById('chat-view');
  const chatTitle = document.getElementById('chat-title');
  const deleteChatBtn = document.getElementById('delete-chat-btn');
  const messagesEl = document.getElementById('messages');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  // Mobile sidebar
  const sidebar = document.querySelector('.sidebar');
  const mobileTopbar = document.querySelector('.mobile-topbar');

  const menuBtn = document.getElementById('menu-btn');

  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.style.display = 'block';
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    setTimeout(() => { overlay.style.display = 'none'; }, 200);
  }

  menuBtn.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);

  // --- Identity ---
  identityBtn.addEventListener('click', identify);
  identityInput.addEventListener('keydown', e => { if (e.key === 'Enter') identify(); });

  function identify() {
    const name = identityInput.value.trim();
    socket.emit('user:identify', name);
  }

  socket.on('user:identified', ({ identifier }) => {
    myIdentifier = identifier;
    identityModal.classList.add('hidden');
    app.classList.remove('hidden');
    userBadge.textContent = identifier;
    loadChats();
  });

  // --- Chat list ---
  async function loadChats() {
    const res = await fetch('/api/chats');
    const chats = await res.json();
    renderChatList(chats);
  }

  function renderChatList(chats) {
    chatList.innerHTML = '';
    chats.forEach(name => addChatItem(name));
  }

  function addChatItem(name) {
    // Avoid duplicates
    if (document.querySelector(`[data-chat="${CSS.escape(name)}"]`)) return;

    const li = document.createElement('li');
    li.dataset.chat = name;
    if (name === currentChat) li.classList.add('active');

    const span = document.createElement('span');
    span.className = 'chat-item-name';
    span.textContent = name;

    const delBtn = document.createElement('button');
    delBtn.className = 'item-delete';
    delBtn.title = 'Eliminar';
    delBtn.textContent = '✕';

    li.appendChild(span);
    li.appendChild(delBtn);
    chatList.appendChild(li);

    li.addEventListener('click', () => openChat(name));
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(name);
    });
  }

  function removeChatItem(name) {
    const el = document.querySelector(`[data-chat="${CSS.escape(name)}"]`);
    if (el) el.remove();
  }

  function setActiveItem(name) {
    document.querySelectorAll('.chat-list li').forEach(li => li.classList.remove('active'));
    const el = document.querySelector(`[data-chat="${CSS.escape(name)}"]`);
    if (el) el.classList.add('active');
  }

  // --- Create chat ---
  createChatBtn.addEventListener('click', createChat);
  newChatInput.addEventListener('keydown', e => { if (e.key === 'Enter') createChat(); });

  async function createChat() {
    const name = newChatInput.value.trim();
    if (!name) return;
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const { name: safe } = await res.json();
      newChatInput.value = '';
      // chat:created will be broadcast; if it's ours we open it
      openChat(safe);
    } else {
      const { error } = await res.json();
      alert(error);
    }
  }

  // --- Delete chat ---
  deleteChatBtn.addEventListener('click', () => {
    if (currentChat && confirm(`¿Eliminar el chat "${currentChat}"?`)) {
      deleteChat(currentChat);
    }
  });

  async function deleteChat(name) {
    const res = await fetch(`/api/chats/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Error' }));
      alert(error);
    }
    // chat:deleted event will handle UI update
  }

  // --- Open chat ---
  async function openChat(name) {
    currentChat = name;
    socket.emit('chat:join', name);
    setActiveItem(name);

    chatTitle.textContent = name;
    emptyState.classList.add('hidden');
    chatView.classList.remove('hidden');

    // Move menu button into chat header for mobile
    const header = document.querySelector('.chat-header');
    if (header && !header.contains(menuBtn)) {
      header.prepend(menuBtn);
    }

    // Load history
    messagesEl.innerHTML = '';
    const res = await fetch(`/api/chats/${encodeURIComponent(name)}/messages`);
    if (res.ok) {
      const messages = await res.json();
      messages.forEach(msg => renderMessage(msg));
      scrollToBottom();
    }

    messageInput.focus();
    closeSidebar();
  }

  // --- Send message ---
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChat) return;
    socket.emit('message:send', { chatName: currentChat, text });
    messageInput.value = '';
  }

  // --- Render message ---
  function renderMessage({ sender, text, timestamp }) {
    const div = document.createElement('div');
    div.className = 'message ' + (sender === myIdentifier ? 'own' : 'other');

    const senderEl = document.createElement('div');
    senderEl.className = 'msg-sender';
    senderEl.textContent = sender;

    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    textEl.textContent = text;

    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    try {
      timeEl.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      timeEl.textContent = '';
    }

    div.appendChild(senderEl);
    div.appendChild(textEl);
    div.appendChild(timeEl);
    messagesEl.appendChild(div);
    return div;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- Socket events ---
  socket.on('message:new', ({ chatName, sender, text, timestamp }) => {
    if (chatName === currentChat) {
      renderMessage({ sender, text, timestamp });
      scrollToBottom();
    }
  });

  socket.on('chat:created', (name) => {
    addChatItem(name);
  });

  socket.on('chat:deleted', (name) => {
    removeChatItem(name);
    if (currentChat === name) {
      currentChat = null;
      chatView.classList.add('hidden');
      emptyState.classList.remove('hidden');
      // Return menu button to the mobile top bar
      if (mobileTopbar && !mobileTopbar.contains(menuBtn)) {
        mobileTopbar.prepend(menuBtn);
      }
    }
  });

  // Auto-identify on load (shows modal)
  // The modal is visible by default; pressing enter or button triggers identify()
})();
