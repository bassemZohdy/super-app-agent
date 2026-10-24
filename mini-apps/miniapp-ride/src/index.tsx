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
        <span style="background: #edf5f8; color: #065f46; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          Demo mobility
        </span>
      </div>

      <!-- Registered Citizen Vehicle -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">REGISTERED SMART VEHICLE (UAE PASS)</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 15px; font-weight: 700; color: #0f172a;">
            🚘 Dubai B-74892 <span style="font-size: 12px; font-weight: 500; color: #285c76;">• Tesla Model Y (EV)</span>
          </div>
          <span style="background: #dbeafe; color: #1e40af; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;">Eco EV Tag</span>
        </div>
      </div>

      <!-- Salik Toll Tag Status -->
      <div style="background: #f0f7f8; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 11px; font-weight: 600; color: #166534;">SALIK / DARB TOLL TAG</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Tag: SLK-8492019 (Active)</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Recent gates: Al Safa, Al Barsha</div>
        </div>
        <div style="text-align: right;">
          <div id="salik_display_balance" style="font-size: 18px; font-weight: 800; color: #285c76;">114.00 AED</div>
          <button id="btn_recharge_salik" style="margin-top: 4px; padding: 5px 12px; background: #285c76; color: #ffffff; border: none; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease;">
            +100 AED Recharge
          </button>
        </div>
      </div>

      <!-- Parking Zones Selector -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 13px; font-weight: 700; color: #334155;">RTA PARKING ZONES (TAP TO SELECT)</span>
        <span style="font-size: 11px; color: #285c76; font-weight: 600;">Interactive Choice</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
        <div id="zone_card_302a" role="button" tabindex="0" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 2px solid #285c76; background: #edf5f8; border-radius: 10px; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div id="zone_radio_302a" style="width: 18px; height: 18px; border-radius: 50%; border: 5px solid #285c76; background: #ffffff;"></div>
            <div>
              <strong style="color: #0f172a; font-size: 14px;">Zone 302A • Downtown Commercial</strong>
              <div style="font-size: 12px; color: #64748b;">Burj Khalifa & Dubai Mall • 42 spots available</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">4.00 AED/hr</div>
            <span id="zone_badge_302a" style="font-size: 10px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: 700;">Selected</span>
          </div>
        </div>

        <div id="zone_card_101b" role="button" tabindex="0" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1.5px solid #e2e8f0; background: #ffffff; border-radius: 10px; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div id="zone_radio_101b" style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid #cbd5e1; background: #ffffff;"></div>
            <div>
              <strong style="color: #0f172a; font-size: 14px;">Zone 101B • Business Bay Waterfront</strong>
              <div style="font-size: 12px; color: #64748b;">Executive Towers • 85 spots available</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">3.00 AED/hr</div>
            <span id="zone_badge_101b" style="font-size: 10px; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 600; display: none;">Select</span>
          </div>
        </div>
      </div>

      <button id="btn_miniapp_activate_parking" style="width: 100%; padding: 13px; border-radius: 10px; background: #285c76; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(5,150,105,0.25);">
        🅿️ Activate Smart Parking Meter (Zone 302A • 2 Hours • 8.00 AED)
      </button>
    </div>
  `;

  let selectedZone = 'zone_302a';
  const card302 = context.container.querySelector('#zone_card_302a') as HTMLElement | null;
  const card101 = context.container.querySelector('#zone_card_101b') as HTMLElement | null;
  const radio302 = context.container.querySelector('#zone_radio_302a') as HTMLElement | null;
  const radio101 = context.container.querySelector('#zone_radio_101b') as HTMLElement | null;
  const badge302 = context.container.querySelector('#zone_badge_302a') as HTMLElement | null;
  const badge101 = context.container.querySelector('#zone_badge_101b') as HTMLElement | null;
  const activateBtn = context.container.querySelector('#btn_miniapp_activate_parking') as HTMLButtonElement | null;
  const rechargeBtn = context.container.querySelector('#btn_recharge_salik') as HTMLButtonElement | null;

  const updateZoneSelection = (zone: 'zone_302a' | 'zone_101b') => {
    selectedZone = zone;
    if (zone === 'zone_302a') {
      if (card302) { card302.style.borderColor = '#285c76'; card302.style.background = '#edf5f8'; }
      if (card101) { card101.style.borderColor = '#e2e8f0'; card101.style.background = '#ffffff'; }
      if (radio302) { radio302.style.border = '5px solid #285c76'; }
      if (radio101) { radio101.style.border = '2px solid #cbd5e1'; }
      if (badge302) { badge302.style.display = 'inline-block'; badge302.textContent = 'Selected'; }
      if (badge101) { badge101.style.display = 'none'; }
      if (activateBtn) activateBtn.innerHTML = '🅿️ Activate Smart Parking Meter (Zone 302A • 2 Hours • 8.00 AED)';
    } else {
      if (card101) { card101.style.borderColor = '#285c76'; card101.style.background = '#edf5f8'; }
      if (card302) { card302.style.borderColor = '#e2e8f0'; card302.style.background = '#ffffff'; }
      if (radio101) { radio101.style.border = '5px solid #285c76'; }
      if (radio302) { radio302.style.border = '2px solid #cbd5e1'; }
      if (badge101) { badge101.style.display = 'inline-block'; badge101.textContent = 'Selected'; }
      if (badge302) { badge302.style.display = 'none'; }
      if (activateBtn) activateBtn.innerHTML = '🅿️ Activate Smart Parking Meter (Zone 101B • 2 Hours • 6.00 AED)';
    }
  };

  card302?.addEventListener('click', () => updateZoneSelection('zone_302a'));
  card101?.addEventListener('click', () => updateZoneSelection('zone_101b'));

  activateBtn?.addEventListener('click', () => {
    activateBtn.disabled = true;
    activateBtn.innerHTML = '⏳ Activating Parking Meter with RTA...';
    context.onDispatchEvent('PARKING_ACTIVATED', {
      zoneId: selectedZone,
      durationHours: 2,
      plateNumber: 'Dubai B-74892',
    });
  });

  // The host is expected to update the balance from its confirmed result; this module must not change the display itself.
  rechargeBtn?.addEventListener('click', () => {
    rechargeBtn.disabled = true;
    rechargeBtn.innerHTML = '⏳ Request sent';
    setTimeout(() => {
      rechargeBtn.disabled = false;
      rechargeBtn.innerHTML = '+100 AED Recharge';
    }, 1500);

    context.onDispatchEvent('SALIK_RECHARGED', {
      amount: 100,
      tagId: 'SLK-8492019',
    });
  });
}

export function unmountRideMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
