/**
 * Card component stories
 * Card layouts used throughout ZE-POS
 */

// Basic card
export const Basic = {
  render: () => `
    <div class="card" style="width: 400px;">
      <div class="card-header">
        <h3>Card Title</h3>
      </div>
      <div class="card-body">
        <p>This is a basic card with header and body content.</p>
      </div>
    </div>
  `,
};

// Card with actions in header
export const WithActions = {
  render: () => `
    <div class="card" style="width: 400px;">
      <div class="card-header">
        <h3>Menu Items</h3>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-primary btn-sm">+ Add Item</button>
        </div>
      </div>
      <div class="card-body">
        <p>Card with action buttons in header.</p>
      </div>
    </div>
  `,
};

// Card with footer
export const WithFooter = {
  render: () => `
    <div class="card" style="width: 400px;">
      <div class="card-header">
        <h3>Confirm Action</h3>
      </div>
      <div class="card-body">
        <p>Are you sure you want to proceed?</p>
      </div>
      <div class="modal-footer" style="border-top:1px solid var(--border);padding:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-outline">Cancel</button>
        <button class="btn btn-danger">Delete</button>
      </div>
    </div>
  `,
};

// Empty state card
export const EmptyState = {
  render: () => `
    <div class="card" style="width: 400px;">
      <div class="card-body empty-state" style="padding: 40px 20px;">
        <span class="icon" style="font-size: 3rem;">📦</span>
        <h3>No items found</h3>
        <p>Get started by adding your first item.</p>
        <button class="btn btn-primary" style="margin-top: 16px;">Add Item</button>
      </div>
    </div>
  `,
};

// Stats card (dashboard style)
export const StatCard = {
  render: () => `
    <div class="stat-card" style="width: 200px;">
      <div class="stat-icon green">💵</div>
      <div class="stat-info">
        <div class="stat-label">Today's Revenue</div>
        <div class="stat-value">$1,234.56</div>
      </div>
    </div>
  `,
};

// Multiple stat cards grid
export const StatGrid = {
  render: () => `
    <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
      <div class="stat-card">
        <div class="stat-icon green">💵</div>
        <div class="stat-info">
          <div class="stat-label">Revenue</div>
          <div class="stat-value">$1,234.56</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">📦</div>
        <div class="stat-info">
          <div class="stat-label">Orders</div>
          <div class="stat-value">42</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">👥</div>
        <div class="stat-info">
          <div class="stat-label">Customers</div>
          <div class="stat-value">18</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">📊</div>
        <div class="stat-info">
          <div class="stat-label">Avg Order</div>
          <div class="stat-value">$29.40</div>
        </div>
      </div>
    </div>
  `,
};

// Card with table
export const WithTable = {
  render: () => `
    <div class="card" style="width: 600px;">
      <div class="card-header">
        <h3>Recent Orders</h3>
      </div>
      <div class="card-body" style="padding:0;">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Type</th>
                <th>Total</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>#1001</strong></td>
                <td><span class="badge badge-info">Dine-In</span></td>
                <td>$25.50</td>
                <td class="text-muted">10:30 AM</td>
              </tr>
              <tr>
                <td><strong>#1002</strong></td>
                <td><span class="badge badge-warning">Takeaway</span></td>
                <td>$18.00</td>
                <td class="text-muted">10:45 AM</td>
              </tr>
              <tr>
                <td><strong>#1003</strong></td>
                <td><span class="badge badge-success">Delivery</span></td>
                <td>$32.75</td>
                <td class="text-muted">11:00 AM</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
};

// POS Cart card style
export const PosCart = {
  render: () => `
    <div class="card" style="width: 360px;">
      <div class="card-header">
        <h3>Current Order</h3>
      </div>
      <div class="card-body" style="padding:0;max-height:300px;overflow:auto;">
        <div class="pos-cart-items">
          <div class="pos-cart-item" style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);">
            <div>
              <strong>Zinger Burger</strong>
              <br><small class="text-muted">Large</small>
            </div>
            <div style="text-align:right;">
              <div>2 x $12.50</div>
              <strong>$25.00</strong>
            </div>
          </div>
          <div class="pos-cart-item" style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);">
            <div>
              <strong>Fries</strong>
              <br><small class="text-muted">Medium</small>
            </div>
            <div style="text-align:right;">
              <div>1 x $4.50</div>
              <strong>$4.50</strong>
            </div>
          </div>
        </div>
      </div>
      <div class="pos-cart-footer" style="padding:16px;border-top:2px solid var(--border);">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Subtotal</span>
          <strong>$29.50</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span>Tax (10%)</span>
          <strong>$2.95</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;">
          <span>Total</span>
          <strong>$32.45</strong>
        </div>
        <button class="btn-complete-order" style="margin-top:12px;">Complete Order</button>
      </div>
    </div>
  `,
};