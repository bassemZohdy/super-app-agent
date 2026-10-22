export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountWalletMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">💳</span>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Wallet & Payments</h2>
            <div style="font-size: 12px; color: #64748b;">Autonomous Microfrontend • org.superapp.wallet</div>
          </div>
        </div>
        <span style="background: #ecfdf5; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          ZERO-TRUST VAULT
        </span>
      </div>

      <!-- Digital Card Preview -->
      <div style="background: linear-gradient(135deg, #1e3a8a, #3b82f6); border-radius: 14px; padding: 20px; color: #ffffff; margin-bottom: 20px; box-shadow: 0 10px 15px -3px rgba(37,99,235,0.25);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <span style="font-size: 14px; font-weight: 600; opacity: 0.9;">SuperApp Platinum Card</span>
          <span style="font-weight: 800; font-size: 16px; letter-spacing: 1px;">VISA</span>
        </div>
        <div style="font-size: 12px; opacity: 0.8; margin-bottom: 4px;">CURRENT BALANCE</div>
        <div style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">$142.50 USD</div>
        <div style="display: flex; justify-content: space-between; margin-top: 18px; font-size: 12px; opacity: 0.85;">
          <span>•••• •••• •••• 4242</span>
          <span>EXP 08/29</span>
        </div>
      </div>

      <!-- Quick Top Up Action -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px;">QUICK TOP-UP</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 20px;">
        <button id="btn_topup_20" style="padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; font-weight: 700; font-size: 14px; color: #0f172a; cursor: pointer;">
          +$20
        </button>
        <button id="btn_topup_50" style="padding: 10px; border: 2px solid #10b981; border-radius: 8px; background: #ecfdf5; font-weight: 700; font-size: 14px; color: #065f46; cursor: pointer;">
          +$50
        </button>
        <button id="btn_topup_100" style="padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; font-weight: 700; font-size: 14px; color: #0f172a; cursor: pointer;">
          +$100
        </button>
      </div>

      <!-- Recent Transactions -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px;">RECENT TRANSACTIONS</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <div>
            <div style="font-weight: 600; color: #0f172a;">Morning Coffee Express</div>
            <div style="font-size: 11px; color: #94a3b8;">Today, 8:45 AM</div>
          </div>
          <div style="font-weight: 700; color: #ef4444;">-$7.50</div>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px; font-size: 13px;">
          <div>
            <div style="font-weight: 600; color: #0f172a;">Card Auto-Reload</div>
            <div style="font-size: 11px; color: #94a3b8;">Yesterday</div>
          </div>
          <div style="font-weight: 700; color: #10b981;">+$50.00</div>
        </div>
      </div>
    </div>
  `;

  context.container.querySelector('#btn_topup_20')?.addEventListener('click', () => {
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 20.0 });
  });
  context.container.querySelector('#btn_topup_50')?.addEventListener('click', () => {
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 50.0 });
  });
  context.container.querySelector('#btn_topup_100')?.addEventListener('click', () => {
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 100.0 });
  });
}

export function unmountWalletMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
