export interface MiniAppBootstrapContext {
  container: HTMLElement;
  sessionId: string;
  onDispatchEvent: (eventName: string, payload: Record<string, any>) => void;
}

export function mountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = `
    <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 28px;">🚗</span>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Smart Mobility & Parking</h2>
            <div style="font-size: 12px; color: #64748b;">RTA Dubai & Mawaqif Abu Dhabi • gov.smartcity.mobility</div>
          </div>
        </div>
        <span style="background: #ecfdf5; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          LIVE MOBILITY GRID
        </span>
      </div>

      <!-- Registered Citizen Vehicle -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">REGISTERED SMART VEHICLE (UAE PASS)</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
            🚘 Dubai B-74892 <span style="font-size: 12px; font-weight: 500; color: #059669;">• Tesla Model Y (EV)</span>
          </div>
          <span style="background: #dbeafe; color: #1e40af; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;">Eco EV Tag</span>
        </div>
      </div>

      <!-- Salik Toll Tag Status -->
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 11px; font-weight: 600; color: #166534;">SALIK / DARB TOLL TAG</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Tag: SLK-8492019 (Active)</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Recent gates: Al Safa, Al Barsha</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 18px; font-weight: 800; color: #059669;">114.00 AED</div>
          <button id="btn_recharge_salik" style="margin-top: 4px; padding: 4px 10px; background: #059669; color: #ffffff; border: none; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;">
            +100 AED Recharge
          </button>
        </div>
      </div>

      <!-- Parking Zones Selector -->
      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px;">RTA PARKING ZONES</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 2px solid #059669; background: #ecfdf5; border-radius: 10px;">
          <div>
            <strong style="color: #0f172a; font-size: 14px;">Zone 302A • Downtown Commercial</strong>
            <div style="font-size: 12px; color: #64748b;">Burj Khalifa & Dubai Mall • 42 spots available</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">4.00 AED/hr</div>
            <span style="font-size: 10px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Nearest</span>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; background: #ffffff; border-radius: 10px;">
          <div>
            <strong style="color: #0f172a; font-size: 14px;">Zone 101B • Business Bay Waterfront</strong>
            <div style="font-size: 12px; color: #64748b;">Executive Towers • 85 spots available</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">3.00 AED/hr</div>
          </div>
        </div>
      </div>

      <button id="btn_miniapp_activate_parking" style="width: 100%; padding: 12px; border-radius: 10px; background: #059669; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer; transition: background 0.15s ease;">
        🅿️ Activate Smart Parking Meter (Zone 302A • 2 Hours • 8.00 AED)
      </button>
    </div>
  `;

  context.container.querySelector('#btn_miniapp_activate_parking')?.addEventListener('click', () => {
    context.onDispatchEvent('PARKING_ACTIVATED', {
      zoneId: 'zone_302a',
      durationHours: 2,
      plateNumber: 'Dubai B-74892',
    });
  });

  context.container.querySelector('#btn_recharge_salik')?.addEventListener('click', () => {
    context.onDispatchEvent('SALIK_RECHARGED', {
      amount: 100,
      tagId: 'SLK-8492019',
    });
  });
}

export function unmountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
