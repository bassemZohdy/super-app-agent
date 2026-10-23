export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountFoodMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">⚡</span>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Smart Utilities & Energy</h2>
            <div style="font-size: 12px; color: #64748b;">DEWA Dubai & ADDC Abu Dhabi • gov.smartcity.utilities</div>
          </div>
        </div>
        <span style="background: #ecfdf5; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          SMART METER CONNECTED
        </span>
      </div>

      <!-- Premise Summary -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 2px;">CONNECTED PREMISE (EJARI)</div>
            <div style="font-size: 14px; font-weight: 700; color: #0f172a;">Downtown Residences 1, Unit 1402</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Premise ID: DEWA-201948201 • Meter: SM-DXB-99824</div>
          </div>
          <span style="background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
            🌱 Green Slab
          </span>
        </div>
      </div>

      <!-- Real-Time Telemetry Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #64748b;">ELECTRICITY CONSUMPTION</div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px;">480 kWh</div>
          <div style="font-size: 11px; color: #059669; margin-top: 2px;">Low Emission Tier</div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #64748b;">WATER CONSUMPTION</div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px;">1,200 Gal</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">High-Efficiency Flow</div>
        </div>
      </div>

      <!-- Itemized Bill Breakdown -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 8px;">OCTOBER 2026 BILL BREAKDOWN</div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 20px; overflow: hidden;">
        <div style="display: flex; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <span style="color: #64748b;">Electricity (DEWA Smart Grid)</span>
          <span style="font-weight: 600; color: #0f172a;">110.40 AED</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <span style="color: #64748b;">Water (Desalination Grid)</span>
          <span style="font-weight: 600; color: #0f172a;">42.00 AED</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <span style="color: #64748b;">Dubai Municipality Housing Fee (5%)</span>
          <span style="font-weight: 600; color: #0f172a;">240.00 AED</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px;">
          <span style="color: #64748b;">Sewerage & Environment Fee</span>
          <span style="font-weight: 600; color: #0f172a;">28.00 AED</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 12px 14px; background: #f8fafc; font-size: 14px; font-weight: 700;">
          <span>Total Outstanding Amount</span>
          <span style="color: #059669; font-size: 16px;">420.40 AED</span>
        </div>
      </div>

      <button id="btn_miniapp_pay_dewa" style="width: 100%; padding: 13px; border-radius: 10px; background: #059669; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(5,150,105,0.25);">
        ⚡ Settle DEWA Bill via DubaiPay (420.40 AED)
      </button>
    </div>
  `;

  const payBtn = context.container.querySelector('#btn_miniapp_pay_dewa') as HTMLButtonElement | null;
  payBtn?.addEventListener('click', () => {
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.innerHTML = '⏳ Settling DEWA Smart Grid Bill via DubaiPay...';
    }
    context.onDispatchEvent('DEWA_BILL_PAID', {
      billId: 'DEWA-2026-10-8492',
      premiseId: 'DEWA-201948201',
      totalAmount: 420.4,
    });
  });
}

export function unmountFoodMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
