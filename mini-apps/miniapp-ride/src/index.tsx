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
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Ride & Mobility</h2>
            <div style="font-size: 12px; color: #64748b;">Autonomous Microfrontend • org.superapp.ride</div>
          </div>
        </div>
        <span style="background: #eff6ff; color: #2563eb; font-size: 11px; font-weight: 700; padding: 4px 10px; borderRadius: 20px;">
          LIVE FLEET
        </span>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 6px;">CURRENT ROUTE</div>
        <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #0f172a;">
          <span>📍 100 Market St</span>
          <span style="color: #94a3b8;">➔</span>
          <span>🏁 Downtown Restaurant</span>
        </div>
      </div>

      <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px;">AVAILABLE TIERS</div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 2px solid #2563eb; background: #eff6ff; border-radius: 10px;">
          <div>
            <strong style="color: #0f172a; font-size: 14px;">Comfort Sedan</strong>
            <div style="font-size: 12px; color: #64748b;">4 mins away • Alex M. (4.9 ★)</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 16px;">$22.00</div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; background: #ffffff; border-radius: 10px;">
          <div>
            <strong style="color: #0f172a; font-size: 14px;">Executive SUV</strong>
            <div style="font-size: 12px; color: #64748b;">7 mins away • Marcus C. (4.95 ★)</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 16px;">$35.00</div>
          </div>
        </div>
      </div>

      <button id="btn_miniapp_book_ride" style="width: 100%; padding: 12px; border-radius: 10px; background: #2563eb; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer;">
        Dispatch Comfort Sedan ($22.00)
      </button>
    </div>
  `;

  const btn = context.container.querySelector('#btn_miniapp_book_ride');
  btn?.addEventListener('click', () => {
    context.onDispatchEvent('RIDE_BOOKED', {
      tier: 'Comfort Sedan',
      driver: 'Alex M.',
      fare: 22.0,
      etaMinutes: 4,
    });
  });
}

export function unmountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
