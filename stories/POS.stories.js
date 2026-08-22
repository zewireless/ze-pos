/**
 * POS-specific component stories
 * Product cards, cart items, order type selectors, etc.
 */

// Product card (menu item in POS grid)
export const ProductCard = {
  render: () => `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;width:500px;">
      ${[
        { name: 'Zinger Burger', price: 12.50, category: 'Burgers', image: null },
        { name: 'Chicken Sandwich', price: 10.00, category: 'Burgers', image: null },
        { name: 'Fries (Large)', price: 4.50, category: 'Sides', image: null },
        { name: 'Soft Drink', price: 2.50, category: 'Drinks', image: null },
        { name: 'Onion Rings', price: 5.00, category: 'Sides', image: null },
        { name: 'Chocolate Shake', price: 5.50, category: 'Drinks', image: null },
      ].map(item => `
        <div class="product-card" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:all 0.2s;">
          <div style="aspect-ratio:1;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:2.5rem;overflow:hidden;">
            ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;">` : '🍔'}
          </div>
          <div style="padding:12px;">
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">${item.category}</div>
            <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
            <div style="color:var(--primary);font-weight:700;font-size:1rem;margin-top:4px;">$${item.price.toFixed(2)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `,
};

// Product card with image
export const ProductCardWithImage = {
  render: () => `
    <div class="product-card" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;width:200px;">
      <div style="aspect-ratio:1;background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);display:flex;align-items:center;justify-content:center;font-size:3rem;">
        🍔
      </div>
      <div style="padding:12px;">
        <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Burgers</div>
        <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Zinger Burger</div>
        <div style="color:var(--primary);font-weight:700;font-size:1rem;margin-top:4px;">$12.50</div>
      </div>
    </div>
  `,
};

// Product card - out of stock
export const ProductCardOutOfStock = {
  render: () => `
    <div class="product-card" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;opacity:0.5;cursor:not-allowed;width:200px;position:relative;">
      <div style="aspect-ratio:1;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:2.5rem;">
        🍟
      </div>
      <div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:1.2rem;">
        OUT OF STOCK
      </div>
      <div style="padding:12px;">
        <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Sides</div>
        <div style="font-weight:600;font-size:0.9rem;">Fries (Large)</div>
        <div style="color:var(--danger);font-weight:700;font-size:1rem;margin-top:4px;">$4.50</div>
      </div>
    </div>
  `,
};

// Order type selector
export const OrderTypeSelector = {
  render: () => `
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="pos-order-type" style="flex:1;min-width:100px;padding:12px;background:var(--primary);color:white;border:none;border-radius:var(--radius);font-weight:600;cursor:pointer;">
        🍽 Dine-In
      </button>
      <button class="pos-order-type" style="flex:1;min-width:100px;padding:12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:600;cursor:pointer;">
        🥡 Takeaway
      </button>
      <button class="pos-order-type" style="flex:1;min-width:100px;padding:12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:600;cursor:pointer;">
        🚴 Delivery
      </button>
    </div>
  `,
};

// Category tabs
export const CategoryTabs = {
  render: () => `
    <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:8px;">
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--primary);color:white;border:none;border-radius:var(--radius);font-weight:500;white-space:nowrap;">All</button>
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:500;white-space:nowrap;">Burgers</button>
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:500;white-space:nowrap;">Drinks</button>
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:500;white-space:nowrap;">Sides</button>
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:500;white-space:nowrap;">Desserts</button>
      <button class="pos-category-tab" style="padding:8px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);font-weight:500;white-space:nowrap;">Combos</button>
    </div>
  `,
};

// Favorites bar
export const FavoritesBar = {
  render: () => `
    <div style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;">
      ${[
        { name: 'Zinger', emoji: '🍔' },
        { name: 'Fries', emoji: '🍟' },
        { name: 'Coke', emoji: '🥤' },
        { name: 'Shake', emoji: '🍦' },
        { name: 'Nuggets', emoji: '🍗' },
        { name: 'Salad', emoji: '🥗' },
        { name: 'Wrap', emoji: '🌯' },
        { name: 'Coffee', emoji: '☕' },
      ].map(fav => `
        <button class="favorite-btn" style="min-width:70px;padding:10px 8px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;transition:all 0.2s;">
          <span style="font-size:1.5rem;">${fav.emoji}</span>
          <span style="font-size:0.75rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fav.name}</span>
        </button>
      `).join('')}
    </div>
  `,
};

// Cart item
export const CartItem = {
  render: () => `
    <div style="width:360px;">
      <div class="pos-cart-item" style="display:flex;gap:12px;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);">
        <div style="width:48px;height:48px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">
          🍔
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;">
            <strong style="font-size:0.95rem;">Zinger Burger</strong>
            <span style="color:var(--primary);font-weight:700;">$25.00</span>
          </div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">Large</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <button class="qty-btn" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;">−</button>
            <span style="min-width:24px;text-align:center;font-weight:600;">2</span>
            <button class="qty-btn" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;">+</button>
            <span class="text-muted" style="font-size:0.8rem;">2 x $12.50</span>
          </div>
        </div>
        <button class="btn-ghost btn-sm" style="color:var(--danger);padding:4px;">🗑</button>
      </div>
    </div>
  `,
};

// Cart item with condiments
export const CartItemWithCondiments = {
  render: () => `
    <div style="width:360px;">
      <div class="pos-cart-item" style="display:flex;gap:12px;padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);">
        <div style="width:48px;height:48px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">
          🍔
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;">
            <strong style="font-size:0.95rem;">Zinger Burger</strong>
            <span style="color:var(--primary);font-weight:700;">$14.50</span>
          </div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">Large</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
            <span class="badge badge-gray" style="font-size:0.7rem;">+ Extra Cheese</span>
            <span class="badge badge-gray" style="font-size:0.7rem;">+ Bacon</span>
            <span class="badge badge-gray" style="font-size:0.7rem;">No Pickles</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
            <button class="qty-btn" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;">−</button>
            <span style="min-width:24px;text-align:center;font-weight:600;">1</span>
            <button class="qty-btn" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;">+</button>
            <span class="text-muted" style="font-size:0.8rem;">1 x $14.50</span>
          </div>
        </div>
        <button class="btn-ghost btn-sm" style="color:var(--danger);padding:4px;">🗑</button>
      </div>
    </div>
  `,
};

// Numpad
export const Numpad = {
  render: () => `
    <div style="width:280px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;box-shadow:var(--shadow-lg);">
      <div style="background:var(--bg);border-radius:var(--radius);padding:16px;text-align:right;font-size:1.5rem;font-weight:600;margin-bottom:16px;font-family:monospace;">
        $0.00
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        ${[1,2,3,4,5,6,7,8,9].map(num => `
          <button class="numpad-btn" style="aspect-ratio:1;border:none;border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:1.5rem;font-weight:600;cursor:pointer;transition:background 0.1s;">${num}</button>
        `).join('')}
        <button class="numpad-btn" style="aspect-ratio:1;border:none;border-radius:var(--radius);background:var(--bg);color:var(--text-muted);font-size:1.5rem;cursor:pointer;">0</button>
        <button class="numpad-btn" style="aspect-ratio:1;border:none;border-radius:var(--radius);background:var(--warning);color:white;font-size:1.5rem;cursor:pointer;">C</button>
        <button class="numpad-btn" style="grid-column:span 3;aspect-ratio:1.5;border:none;border-radius:var(--radius);background:var(--success);color:white;font-size:1.25rem;font-weight:700;cursor:pointer;">ENTER</button>
      </div>
    </div>
  `,
};

// Quantity selector (for product detail modal)
export const QuantitySelector = {
  render: () => `
    <div style="display:flex;align-items:center;gap:16px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);width:320px;">
      <div style="width:64px;height:64px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:2rem;">
        🍔
      </div>
      <div style="flex:1;">
        <strong>Zinger Burger</strong>
        <div class="text-muted" style="font-size:0.85rem;">Large - $12.50 each</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <button class="qty-btn" style="width:44px;height:44px;border-radius:50%;border:2px solid var(--primary);background:var(--card);color:var(--primary);font-size:1.5rem;display:flex;align-items:center;justify-content:center;cursor:pointer;">−</button>
        <span style="font-size:1.5rem;font-weight:700;min-width:40px;text-align:center;">3</span>
        <button class="qty-btn" style="width:44px;height:44px;border-radius:50%;border:2px solid var(--primary);background:var(--card);color:var(--primary);font-size:1.5rem;display:flex;align-items:center;justify-content:center;cursor:pointer;">+</button>
      </div>
    </div>
  `,
};

// Receipt preview
export const ReceiptPreview = {
  render: () => `
    <div style="width:320px;background:white;border:1px solid var(--border);border-radius:var(--radius);padding:20px;font-family:'Courier New',monospace;font-size:0.8rem;line-height:1.6;">
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:1.5rem;font-weight:700;">ZE·POS</div>
        <div class="text-muted">123 Main Street</div>
        <div class="text-muted">Tel: (555) 123-4567</div>
      </div>
      <hr style="border:none;border-top:1px dashed var(--border);margin:12px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Order #</span>
        <strong>1005</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Type</span>
        <strong>Dine-In</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Cashier</span>
        <strong>John Doe</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Time</span>
        <strong>10:30 AM</strong>
      </div>
      <hr style="border:none;border-top:1px dashed var(--border);margin:12px 0;">
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Zinger Burger</span>
          <span>$12.50</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:0.75rem;padding-left:8px;">
          <span>Large</span>
          <span>1 x $12.50</span>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Fries</span>
          <span>$4.50</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:0.75rem;padding-left:8px;">
          <span>Medium</span>
          <span>1 x $4.50</span>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;">
          <span>Soft Drink</span>
          <span>$2.50</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:0.75rem;padding-left:8px;">
          <span>Regular</span>
          <span>1 x $2.50</span>
        </div>
      </div>
      <hr style="border:none;border-top:1px dashed var(--border);margin:12px 0;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Subtotal</span>
        <strong>$19.50</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span>Tax (10%)</span>
        <strong>$1.95</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:700;border-top:1px solid var(--border);padding-top:8px;">
        <span>TOTAL</span>
        <strong>$21.45</strong>
      </div>
      <hr style="border:none;border-top:1px dashed var(--border);margin:12px 0;">
      <div style="text-align:center;color:var(--text-muted);font-size:0.75rem;">
        <div>Thank you for your order!</div>
        <div>Please come again</div>
      </div>
    </div>
  `,
};

// Shift status badge
export const ShiftStatus = {
  render: () => `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
      <span class="badge badge-success" style="font-size:0.85rem;padding:8px 12px;">● Shift Active</span>
      <span class="badge badge-info" style="font-size:0.85rem;padding:8px 12px;">🍽 Dine-In</span>
      <span class="badge badge-warning" style="font-size:0.85rem;padding:8px 12px;">☕ On Break</span>
      <span class="badge badge-danger" style="font-size:0.85rem;padding:8px 12px;">🔴 Shift Ended</span>
    </div>
  `,
};

// Low stock alert badge
export const StockAlerts = {
  render: () => `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
      <div style="padding:12px 16px;background:#fff7ed;border:1px solid #fde68a;border-radius:var(--radius);display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">⚠️</span>
        <div>
          <div style="font-weight:600;">Low Stock Alert</div>
          <div class="text-muted" style="font-size:0.85rem;">Fries - 5 remaining (threshold: 10)</div>
        </div>
        <button class="btn btn-primary btn-sm">Restock</button>
      </div>
      <div style="padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius);display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">🚫</span>
        <div>
          <div style="font-weight:600;color:var(--danger);">Out of Stock</div>
          <div class="text-muted" style="font-size:0.85rem;">Onion Rings - 0 remaining</div>
        </div>
        <button class="btn btn-danger btn-sm">Restock</button>
      </div>
    </div>
  `,
};

// Bundle card (for POS combo selection)
export const BundleCard = {
  render: () => `
    <div class="bundle-card" style="background:var(--card);border:2px solid var(--primary);border-radius:var(--radius);overflow:hidden;width:280px;">
      <div style="background:linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);color:white;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>🍽 Family Combo</strong>
          <span style="font-size:1.25rem;font-weight:700;">$29.99</span>
        </div>
        <div class="text-muted" style="font-size:0.85rem;margin-top:4px;">Save $8.50 (22%)</div>
      </div>
      <div style="padding:16px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">INCLUDES:</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
              <span>2× Zinger Burger</span>
              <span class="text-muted">$25.00</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
              <span>2× Fries (Large)</span>
              <span class="text-muted">$9.00</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
              <span>2× Soft Drink</span>
              <span class="text-muted">$5.00</span>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border);">
          <span class="text-muted">Individual Total</span>
          <strong style="text-decoration:line-through;color:var(--text-muted);">$39.00</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:700;color:var(--success);">
          <span>Bundle Price</span>
          <span>$29.99</span>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:12px;">Add to Order</button>
    </div>
  `,
};