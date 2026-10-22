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
          <span style="font-size: 28px;">🍕</span>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Food & Dining</h2>
            <div style="font-size: 12px; color: #64748b;">Autonomous Microfrontend • org.superapp.food</div>
          </div>
        </div>
        <span style="background: #fef3c7; color: #b45309; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px;">
          20-30 MINS
        </span>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="font-weight: 700; font-size: 16px; color: #0f172a;">Pizza Napoli & Trattoria</div>
        <div style="font-size: 12px; color: #64748b;">Authentic Neapolitan • 4.8 ★ (1,240 reviews)</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <div>
            <div style="font-weight: 600; font-size: 14px; color: #0f172a;">Woodfired Pizza Diavola</div>
            <div style="font-size: 12px; color: #64748b;">Spicy salami, San Marzano tomatoes, mozzarella</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">$18.00</div>
            <span style="font-size: 10px; background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Spicy</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <div>
            <div style="font-weight: 600; font-size: 14px; color: #0f172a;">Truffle Tagliatelle</div>
            <div style="font-size: 12px; color: #64748b;">Fresh egg pasta, black truffle cream, parmigiano</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: #0f172a; font-size: 15px;">$22.50</div>
            <span style="font-size: 10px; background: #ecfdf5; color: #065f46; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Vegetarian</span>
          </div>
        </div>
      </div>

      <button id="btn_miniapp_order_food" style="width: 100%; padding: 12px; border-radius: 10px; background: #ea580c; color: #ffffff; font-weight: 700; border: none; font-size: 14px; cursor: pointer;">
        Order Pizza Diavola ($18.00)
      </button>
    </div>
  `;

  const btn = context.container.querySelector('#btn_miniapp_order_food');
  btn?.addEventListener('click', () => {
    context.onDispatchEvent('FOOD_ORDER_PLACED', {
      restaurantId: 'rest_1',
      restaurantName: 'Pizza Napoli & Trattoria',
      item: 'Woodfired Pizza Diavola',
      amount: 18.0,
    });
  });
}

export function unmountFoodMiniApp(context: MiniAppBootstrapContext) {
  context.container.innerHTML = '';
}
