(function() {
  // Config from script tag
  const script = document.currentScript;
  const agentId = script.getAttribute('data-agent-id');
  const tenantId = script.getAttribute('data-tenant-id');
  const userId = script.getAttribute('data-user-id') || '';
  
  if (!agentId || !tenantId) {
    console.error('Chat Widget: data-agent-id and data-tenant-id are required');
    return;
  }

  const widgetUrl = `${window.location.origin}/widget/${tenantId}/${agentId}${userId ? `?userId=${userId}` : ''}`;
  
  // Create styles
  const style = document.createElement('style');
  style.innerHTML = `
    .saas-widget-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .saas-widget-button {
      width: 56px;
      height: 56px;
      border-radius: 28px;
      background: #0f172a;
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      items-center: center;
      justify-content: center;
      transition: transform 0.2s;
    }
    .saas-widget-button:hover {
      transform: scale(1.05);
    }
    .saas-widget-button svg {
      width: 24px;
      height: 24px;
    }
    .saas-widget-window {
      position: absolute;
      bottom: 70px;
      right: 0;
      width: 400px;
      height: 600px;
      max-height: calc(100vh - 100px);
      max-width: calc(100vw - 40px);
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border: 1px solid #e2e8f0;
      overflow: hidden;
      display: none;
      flex-direction: column;
    }
    .saas-widget-window.open {
      display: flex;
    }
    .saas-widget-iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
  `;
  document.head.appendChild(style);

  // Create containers
  const container = document.createElement('div');
  container.className = 'saas-widget-container';
  
  const windowDiv = document.createElement('div');
  windowDiv.className = 'saas-widget-window';
  
  const iframe = document.createElement('iframe');
  iframe.className = 'saas-widget-iframe';
  iframe.src = widgetUrl;
  
  windowDiv.appendChild(iframe);
  
  const button = document.createElement('button');
  button.className = 'saas-widget-button';
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12.375m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.023c.09-.457.133-.925.133-1.393a6.002 6.002 0 01-1.043-3.243C5.004 9.444 9.035 5.75 14 5.75s9 3.694 9 8.25z" />
    </svg>
  `;
  
  let isOpen = false;
  button.onclick = function() {
    isOpen = !isOpen;
    if (isOpen) {
      windowDiv.classList.add('open');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      `;
    } else {
      windowDiv.classList.remove('open');
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12.375m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.023c.09-.457.133-.925.133-1.393a6.002 6.002 0 01-1.043-3.243C5.004 9.444 9.035 5.75 14 5.75s9 3.694 9 8.25z" />
        </svg>
      `;
    }
  };

  container.appendChild(windowDiv);
  container.appendChild(button);
  document.body.appendChild(container);

  // Listen for close message from iframe
  window.addEventListener('message', function(event) {
    if (event.data === 'close-saas-widget') {
      isOpen = false;
      windowDiv.classList.remove('open');
    }
  });

})();
