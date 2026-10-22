export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountFoodMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h2>🍕 Food & Dining Mini-App</h2>
      <p>Independent Microfrontend mounted dynamically inside SuperApp Shell.</p>
      <div style="background: #fef3c7; color: #92400e; padding: 15px; border-radius: 8px; margin-top: 10px;">
        <strong>Featured:</strong> Pizza Napoli • Woodfired Diavola & Pasta
      </div>
    </div>
  `;
}

export function unmountFoodMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
