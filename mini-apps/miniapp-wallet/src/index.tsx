export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountWalletMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h2>💳 Wallet & Payments Mini-App</h2>
      <p>Independent Microfrontend mounted dynamically inside SuperApp Shell.</p>
      <div style="background: #ecfdf5; color: #065f46; padding: 15px; border-radius: 8px; margin-top: 10px;">
        <strong>Balance:</strong> $142.50 USD • Visa ending in 4242
      </div>
    </div>
  `;
}

export function unmountWalletMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
