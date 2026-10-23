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
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Citizen Pay & Police Fines</h2>
            <div style="font-size: 12px; color: #64748b;">DubaiPay & Dubai Police HQ • gov.smartcity.citizenpay</div>
          </div>
        </div>
        <span style="background: #ecfdf5; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          UAE PASS VAULT
        </span>
      </div>

      <!-- Digital Citizen Card -->
      <div style="background: linear-gradient(135deg, #064e3b, #059669); border-radius: 14px; padding: 20px; color: #ffffff; margin-bottom: 20px; box-shadow: 0 10px 15px -3px rgba(5,150,105,0.25);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <span style="font-size: 13px; font-weight: 600; opacity: 0.95;">DubaiPay Citizen Wallet</span>
          <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">🌟 Golden Visa</span>
        </div>
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">ACTIVE STORED BALANCE</div>
        <div id="wallet_stored_balance_display" style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">250.00 AED</div>
        <div style="display: flex; justify-content: space-between; margin-top: 16px; font-size: 12px; opacity: 0.85;">
          <span>Bassem Zohdy (784-1988-1234567-1)</span>
          <span>Verified Citizen</span>
        </div>
      </div>

      <!-- Quick Reload -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 8px;">QUICK TOP-UP (INSTANT RELOAD)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 20px;">
        <button id="btn_topup_50" style="padding: 11px; border: 1.5px solid #cbd5e1; border-radius: 8px; background: #f8fafc; font-weight: 700; font-size: 13px; color: #0f172a; cursor: pointer; transition: all 0.15s ease;">
          +50 AED
        </button>
        <button id="btn_topup_100" style="padding: 11px; border: 2px solid #059669; border-radius: 8px; background: #ecfdf5; font-weight: 700; font-size: 13px; color: #065f46; cursor: pointer; transition: all 0.15s ease;">
          +100 AED
        </button>
        <button id="btn_topup_200" style="padding: 11px; border: 1.5px solid #cbd5e1; border-radius: 8px; background: #f8fafc; font-weight: 700; font-size: 13px; color: #0f172a; cursor: pointer; transition: all 0.15s ease;">
          +200 AED
        </button>
      </div>

      <!-- Dubai Police Traffic Fines Card -->
      <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px; background: #f8fafc;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-size: 14px; font-weight: 700; color: #0f172a;">👮 Dubai Police Traffic Fines</div>
            <div style="font-size: 12px; color: #64748b;">Plate: Dubai B-74892 • 2 Pending Violations</div>
          </div>
          <span style="background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
            ✨ 10% Early Discount
          </span>
        </div>

        <div style="font-size: 13px; color: #334155; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0;">
            <span>Radar Speeding (Al Khail Road)</span>
            <span style="font-weight: 600;">270.00 AED</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 6px 0;">
            <span>Parking Overstay (Downtown)</span>
            <span style="font-weight: 600;">150.00 AED</span>
          </div>
        </div>

        <button id="btn_miniapp_pay_fines" style="width: 100%; padding: 12px; border-radius: 8px; background: #0f172a; color: #ffffff; font-weight: 700; border: none; font-size: 13.5px; cursor: pointer; transition: all 0.15s ease;">
          🛡️ Settle Fines with Dubai Police (420.00 AED • 0 Black Points)
        </button>
      </div>

      <!-- Unified Checkout Link -->
      <button id="btn_miniapp_pay_unified" style="width: 100%; padding: 13px; border-radius: 10px; background: #059669; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(5,150,105,0.25);">
        🏛️ Unified Living Settlement (DEWA + Police + Salik • 940.40 AED)
      </button>
    </div>
  `;

  let currentLocalBal = 250.0;
  const balDisplay = context.container.querySelector('#wallet_stored_balance_display') as HTMLElement | null;
  const applyTopupAnim = (amount: number, btnId: string) => {
    currentLocalBal += amount;
    if (balDisplay) balDisplay.textContent = `${currentLocalBal.toFixed(2)} AED`;
    const btn = context.container.querySelector(btnId) as HTMLButtonElement | null;
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Added!';
      setTimeout(() => { if (btn) btn.innerHTML = orig; }, 1200);
    }
  };

  context.container.querySelector('#btn_topup_50')?.addEventListener('click', () => {
    applyTopupAnim(50.0, '#btn_topup_50');
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 50.0 });
  });
  context.container.querySelector('#btn_topup_100')?.addEventListener('click', () => {
    applyTopupAnim(100.0, '#btn_topup_100');
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 100.0 });
  });
  context.container.querySelector('#btn_topup_200')?.addEventListener('click', () => {
    applyTopupAnim(200.0, '#btn_topup_200');
    context.onDispatchEvent('WALLET_TOPPED_UP', { amount: 200.0 });
  });

  const finesBtn = context.container.querySelector('#btn_miniapp_pay_fines') as HTMLButtonElement | null;
  finesBtn?.addEventListener('click', () => {
    if (finesBtn) {
      finesBtn.disabled = true;
      finesBtn.innerHTML = '⏳ Settling Fines with Dubai Police HQ...';
    }
    context.onDispatchEvent('POLICE_FINES_PAID', {
      plateNumber: 'Dubai B-74892',
      amount: 420.0,
    });
  });

  const unifiedBtn = context.container.querySelector('#btn_miniapp_pay_unified') as HTMLButtonElement | null;
  unifiedBtn?.addEventListener('click', () => {
    if (unifiedBtn) {
      unifiedBtn.disabled = true;
      unifiedBtn.innerHTML = '⏳ Reconciling Municipal Settlement across DEWA, Police & Salik...';
    }
    context.onDispatchEvent('UNIFIED_PAY_SETTLED', {
      total: 940.4,
    });
  });
}

export function unmountWalletMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
