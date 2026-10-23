export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountHousingMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">🏠</span>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Housing & Tenancy (Ejari)</h2>
            <div style="font-size: 12px; color: #64748b;">Dubai Land Department & Tawtheeq • gov.smartcity.housing</div>
          </div>
        </div>
        <span style="background: #edf5f8; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          CONTRACT REGISTERED
        </span>
      </div>

      <!-- Ejari Contract Overview -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            <div style="font-size: 11px; font-weight: 600; color: #64748b;">TENANCY CONTRACT</div>
            <div style="font-size: 15px; font-weight: 700; color: #0f172a;">EJR-2026-948102</div>
          </div>
          <span style="background: #dbeafe; color: #1e40af; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">Active 2026-2027</span>
        </div>
        <div style="font-size: 13px; color: #334155;">
          <div><strong>Tenant:</strong> Bassem Zohdy (Golden Visa Resident)</div>
          <div><strong>Property:</strong> Unit 1402, Downtown Residences 1, Downtown Dubai</div>
          <div><strong>Annual Rent:</strong> 96,000 AED / year</div>
          <div><strong>Premise ID:</strong> DEWA-201948201</div>
        </div>
      </div>

      <!-- Autonomous Move-in Golden Path Highlights -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 8px;">MOVE-IN GOLDEN PATH BUNDLE</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f0f7f8; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 13px;">
          <span>⚡</span>
          <div>
            <strong>DEWA Electricity & Water Connection:</strong>
            <span style="color: #285c76; font-weight: 600;"> Deposit Waived (Golden Visa benefit)</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f0f7f8; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 13px;">
          <span>🅿️</span>
          <div>
            <strong>RTA Residential Parking Permit:</strong>
            <span style="color: #285c76; font-weight: 600;"> Zone 302A Digital Permit Issued</span>
          </div>
        </div>
      </div>

      <button id="btn_miniapp_confirm_movein" style="width: 100%; padding: 13px; border-radius: 10px; background: #285c76; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(5,150,105,0.25);">
        🎉 Activate Move-In Golden Path Services
      </button>
    </div>
  `;

  const moveinBtn = context.container.querySelector('#btn_miniapp_confirm_movein') as HTMLButtonElement | null;
  moveinBtn?.addEventListener('click', () => {
    if (moveinBtn) {
      moveinBtn.disabled = true;
      moveinBtn.innerHTML = '⏳ Issuing Ejari, Connecting DEWA & RTA Permit...';
    }
    context.onDispatchEvent('MOVEIN_CONFIRMED', {
      contractNumber: 'EJR-2026-948102',
      unit: 'Unit 1402, Downtown Residences 1',
    });
  });
}

export function unmountHousingMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}

