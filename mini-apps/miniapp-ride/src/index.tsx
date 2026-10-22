export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h2>🚗 Ride & Mobility Mini-App</h2>
      <p>Independent Microfrontend mounted dynamically inside SuperApp Shell.</p>
      <div style="background: #f1f5f9; padding: 15px; border-radius: 8px; margin-top: 10px;">
        <strong>Active Driver:</strong> Alex M. (4.9 ★) - Toyota Camry
      </div>
    </div>
  `;
}

export function unmountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
