/**
 * Form component stories
 * Form inputs, selects, and form layouts used throughout ZE-POS
 */

// Text input
export const TextInput = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:300px;">
      <div class="form-group">
        <label>Item Name <span class="required">*</span></label>
        <input type="text" class="form-control" placeholder="Enter item name">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" class="form-control" placeholder="Optional description" value="Zinger Burger with spicy mayo">
      </div>
      <div class="form-group">
        <label>Disabled Input</label>
        <input type="text" class="form-control" placeholder="Not editable" disabled>
      </div>
    </div>
  `,
};

// Number input
export const NumberInput = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:300px;">
      <div class="form-group">
        <label>Price <span class="required">*</span></label>
        <input type="number" class="form-control" placeholder="0.00" step="0.01" min="0">
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" class="form-control" value="1" min="1" max="99">
      </div>
      <div class="form-row" style="gap:12px;">
        <div class="form-group" style="flex:1;">
          <label>Min</label>
          <input type="number" class="form-control" value="0" min="0">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Max</label>
          <input type="number" class="form-control" value="100" min="0">
        </div>
      </div>
    </div>
  `,
};

// Select dropdown
export const SelectInput = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:300px;">
      <div class="form-group">
        <label>Category <span class="required">*</span></label>
        <select class="form-control">
          <option value="">Select category</option>
          <option value="burgers">Burgers</option>
          <option value="drinks">Drinks</option>
          <option value="sides">Sides</option>
          <option value="desserts">Desserts</option>
        </select>
      </div>
      <div class="form-group">
        <label>Order Type</label>
        <select class="form-control">
          <option value="dine-in">🍽 Dine-In</option>
          <option value="takeaway" selected>🥡 Takeaway</option>
          <option value="delivery">🚴 Delivery</option>
        </select>
      </div>
      <div class="form-group">
        <label>Multiple Select</label>
        <select class="form-control" multiple style="height:100px;">
          <option>Option 1</option>
          <option selected>Option 2</option>
          <option>Option 3</option>
          <option selected>Option 4</option>
          <option>Option 5</option>
        </select>
      </div>
    </div>
  `,
};

// Textarea
export const Textarea = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:400px;">
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" rows="4" placeholder="Enter item description..."></textarea>
      </div>
      <div class="form-group">
        <label>Notes (with value)</label>
        <textarea class="form-control" rows="3">Special instructions: No pickles, extra sauce</textarea>
      </div>
    </div>
  `,
};

// Checkbox
export const Checkbox = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:12px;width:300px;">
      <label class="checkbox-label">
        <input type="checkbox" checked>
        <span>Enabled</span>
      </label>
      <label class="checkbox-label">
        <input type="checkbox">
        <span>Track Stock</span>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" disabled>
        <span>Disabled Option</span>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" checked disabled>
        <span>Disabled but Checked</span>
      </label>
    </div>
  `,
};

// Radio buttons
export const RadioButtons = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:300px;">
      <div class="form-group">
        <label>Pay Type</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label class="radio-label">
            <input type="radio" name="payType" value="hourly" checked>
            <span>Hourly</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="payType" value="salary">
            <span>Salary</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Order Type (inline)</label>
        <div style="display:flex;gap:16px;">
          <label class="radio-label">
            <input type="radio" name="orderType" value="dine-in" checked>
            <span>🍽 Dine-In</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="orderType" value="takeaway">
            <span>🥡 Takeaway</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="orderType" value="delivery">
            <span>🚴 Delivery</span>
          </label>
        </div>
      </div>
    </div>
  `,
};

// Form row (side by side fields)
export const FormRow = {
  render: () => `
    <div style="width:500px;">
      <div class="form-row" style="display:flex;gap:16px;">
        <div class="form-group" style="flex:1;">
          <label>First Name</label>
          <input type="text" class="form-control" placeholder="John">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Last Name</label>
          <input type="text" class="form-control" placeholder="Doe">
        </div>
      </div>
      <div class="form-row" style="display:flex;gap:16px;margin-top:16px;">
        <div class="form-group" style="flex:2;">
          <label>Email</label>
          <input type="email" class="form-control" placeholder="john@example.com">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Phone</label>
          <input type="tel" class="form-control" placeholder="+1 555-0123">
        </div>
      </div>
      <div class="form-row" style="display:flex;gap:16px;margin-top:16px;">
        <div class="form-group" style="flex:1;">
          <label>Role</label>
          <select class="form-control">
            <option>Cashier</option>
            <option>Manager</option>
            <option>Admin</option>
          </select>
        </div>
        <div class="form-group" style="flex:1;">
          <label>Status</label>
          <select class="form-control">
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>
      </div>
    </div>
  `,
};

// Complete form example (Menu Item form)
export const MenuItemForm = {
  render: () => `
    <div class="card" style="width:600px;">
      <div class="card-header">
        <h3>Add Menu Item</h3>
      </div>
      <div class="card-body">
        <form style="display:flex;flex-direction:column;gap:20px;">
          <div class="form-group">
            <label>Item Name <span class="required">*</span></label>
            <input type="text" class="form-control" placeholder="e.g. Zinger Burger">
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2;">
              <label>Category <span class="required">*</span></label>
              <select class="form-control">
                <option value="">Select category</option>
                <option value="burgers">Burgers</option>
                <option value="drinks">Drinks</option>
                <option value="sides">Sides</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Price <span class="required">*</span></label>
              <input type="number" class="form-control" placeholder="0.00" step="0.01" min="0">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-control" rows="3" placeholder="Item description for customers..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:1;">
              <label>Cost Price</label>
              <input type="number" class="form-control" placeholder="0.00" step="0.01" min="0">
            </div>
            <div class="form-group" style="flex:1;">
              <label>Low Stock Threshold</label>
              <input type="number" class="form-control" placeholder="10" min="0">
            </div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" checked>
              <span>Track Stock</span>
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox">
              <span>Enabled</span>
            </label>
          </div>
        </form>
      </div>
      <div class="modal-footer" style="border-top:1px solid var(--border);padding:16px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-outline">Cancel</button>
        <button class="btn btn-primary">Save Item</button>
      </div>
    </div>
  `,
};

// Login form
export const LoginForm = {
  render: () => `
    <div class="card" style="width:400px;">
      <div class="card-body" style="padding:32px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="width:64px;height:64px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:1.5rem;color:white;">🍽</div>
          <h2 style="margin:0 0 8px;">Welcome Back</h2>
          <p class="text-muted">Sign in to your ZE-POS account</p>
        </div>
        <form style="display:flex;flex-direction:column;gap:16px;">
          <div class="form-group">
            <label>Username or Email</label>
            <input type="text" class="form-control" placeholder="Enter username" autocomplete="username">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-control" placeholder="Enter password" autocomplete="current-password">
          </div>
          <div class="form-group" style="display:flex;justify-content:space-between;align-items:center;">
            <label class="checkbox-label" style="margin:0;">
              <input type="checkbox">
              <span>Remember me</span>
            </label>
            <a href="#" class="text-muted" style="font-size:0.85rem;">Forgot password?</a>
          </div>
          <button class="btn btn-primary" style="margin-top:8px;">Sign In</button>
        </form>
        <p class="text-muted" style="text-align:center;margin-top:20px;font-size:0.85rem;">
          Don't have an account? <a href="#">Create one</a>
        </p>
      </div>
    </div>
  `,
};

// Search input with icon
export const SearchInput = {
  render: () => `
    <div style="display:flex;flex-direction:column;gap:16px;width:400px;">
      <div class="form-group" style="position:relative;">
        <label>Search Menu Items</label>
        <div style="position:relative;">
          <input type="text" class="form-control" placeholder="Search..." style="padding-left:40px;">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);">🔍</span>
        </div>
      </div>
      <div class="form-group" style="position:relative;">
        <label>Search with clear</label>
        <div style="position:relative;">
          <input type="text" class="form-control" placeholder="Search..." value="Zinger" style="padding-right:40px;">
          <button type="button" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);cursor:pointer;">✕</button>
        </div>
      </div>
    </div>
  `,
};