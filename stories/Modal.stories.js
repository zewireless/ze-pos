/**
 * Modal component stories
 * Modal dialogs used throughout ZE-POS
 */

// Basic modal
export const Basic = {
  render: () => `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;">
      <div class="modal" style="background:var(--card);border-radius:var(--radius-lg);width:100%;max-width:500px;max-height:90vh;overflow:auto;box-shadow:var(--shadow-lg);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
          <h3 style="margin:0;">Modal Title</h3>
          <button class="modal-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <p>This is a basic modal dialog with some content.</p>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid var(--border);">
          <button class="btn btn-outline">Cancel</button>
          <button class="btn btn-primary">Confirm</button>
        </div>
      </div>
    </div>
  `,
};

// Confirmation dialog
export const ConfirmDialog = {
  render: () => `
    <div class="modal-backdrop confirm-dialog" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;">
      <div class="modal" style="background:var(--card);border-radius:var(--radius-lg);width:100%;max-width:400px;box-shadow:var(--shadow-lg);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
          <h3 style="margin:0;">Confirm Delete</h3>
          <button class="modal-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:2.5rem;color:var(--danger);">⚠️</span>
            <p style="margin:0;">Are you sure you want to delete this item? This action cannot be undone.</p>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid var(--border);">
          <button class="btn btn-outline">Cancel</button>
          <button class="btn btn-danger">Delete</button>
        </div>
      </div>
    </div>
  `,
};

// Form modal
export const FormModal = {
  render: () => `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;">
      <div class="modal" style="background:var(--card);border-radius:var(--radius-lg);width:100%;max-width:500px;max-height:90vh;overflow:auto;box-shadow:var(--shadow-lg);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
          <h3 style="margin:0;">Add Menu Item</h3>
          <button class="modal-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <form style="display:flex;flex-direction:column;gap:16px;">
            <div class="form-group">
              <label>Item Name <span class="required">*</span></label>
              <input type="text" class="form-control" placeholder="e.g. Zinger Burger">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Category</label>
                <select class="form-control">
                  <option>Burgers</option>
                  <option>Drinks</option>
                  <option>Sides</option>
                </select>
              </div>
              <div class="form-group">
                <label>Price</label>
                <input type="number" class="form-control" placeholder="0.00" step="0.01">
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea class="form-control" rows="3" placeholder="Item description..."></textarea>
            </div>
            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" checked> Enabled
              </label>
            </div>
          </form>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid var(--border);">
          <button class="btn btn-outline">Cancel</button>
          <button class="btn btn-primary">Save Item</button>
        </div>
      </div>
    </div>
  `,
};

// Large modal (for complex forms)
export const LargeModal = {
  render: () => `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;">
      <div class="modal" style="background:var(--card);border-radius:var(--radius-lg);width:100%;max-width:800px;max-height:90vh;overflow:auto;box-shadow:var(--shadow-lg);">
        <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">
          <h3 style="margin:0;">Bundle / Combo Builder</h3>
          <button class="modal-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          <div style="display:flex;flex-direction:column;gap:20px;">
            <div class="form-group">
              <label>Bundle Name <span class="required">*</span></label>
              <input type="text" class="form-control" placeholder="e.g. Family Meal Deal">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Bundle Price <span class="required">*</span></label>
                <input type="number" class="form-control" placeholder="0.00" step="0.01">
              </div>
              <div class="form-group">
                <label>Image</label>
                <div class="image-upload" style="border:2px dashed var(--border);border-radius:8px;padding:20px;text-align:center;cursor:pointer;">
                  <span style="font-size:2rem;">📷</span>
                  <p>Click to upload</p>
                  <input type="file" accept="image/*" style="display:none;">
                </div>
              </div>
            </div>
            <h4 style="margin:0 0 12px;">Bundle Items</h4>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <div class="form-row" style="align-items:end;gap:10px;">
                <div class="form-group" style="flex:2;margin:0;">
                  <label>Menu Item</label>
                  <select class="form-control">
                    <option>Select item...</option>
                    <option>Zinger Burger - $12.50</option>
                    <option>Chicken Sandwich - $10.00</option>
                    <option>Fries (Large) - $4.50</option>
                    <option>Soft Drink - $2.50</option>
                  </select>
                </div>
                <div class="form-group" style="flex:1;margin:0;">
                  <label>Qty</label>
                  <input type="number" class="form-control" value="1" min="1" max="99">
                </div>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger);height:42px;">✕</button>
              </div>
              <button class="btn btn-outline btn-sm" style="align-self:flex-start;">+ Add Another Item</button>
            </div>
            <div style="padding:12px;background:var(--bg);border-radius:8px;">
              <strong>Price Preview:</strong>
              <div style="display:flex;gap:16px;margin-top:8px;">
                <span class="badge badge-info">Individual Total: $22.00</span>
                <span class="badge badge-success">Bundle Price: $18.00</span>
                <span class="badge badge-success">Savings: $4.00 (18%)</span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;border-top:1px solid var(--border);">
          <button class="btn btn-outline">Cancel</button>
          <button class="btn btn-primary">Create Bundle</button>
        </div>
      </div>
    </div>
  `,
};

// Success modal
export const SuccessModal = {
  render: () => `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:1000;">
      <div class="modal" style="background:var(--card);border-radius:var(--radius-lg);width:100%;max-width:400px;box-shadow:var(--shadow-lg);text-align:center;">
        <div class="modal-body" style="padding:40px 20px;">
          <div style="width:80px;height:80px;background:var(--success);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:2.5rem;color:white;">
            ✓
          </div>
          <h3 style="margin:0 0 12px;">Order Completed!</h3>
          <p class="text-muted" style="margin:0 0 20px;">Order #1005 has been completed successfully.</p>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
            <span class="badge badge-success">$32.45</span>
            <span class="badge badge-info">3 Items</span>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:center;gap:8px;padding:16px 20px;border-top:1px solid var(--border);">
          <button class="btn btn-primary" style="min-width:120px;">Print Receipt</button>
          <button class="btn btn-outline">Done</button>
        </div>
      </div>
    </div>
  `,
};

// Toast notification (not a modal but related)
export const Toast = {
  render: () => `
    <div style="position:fixed;bottom:20px;right:20px;z-index:2000;display:flex;flex-direction:column;gap:8px;">
      <div class="toast" style="background:var(--card);border-radius:var(--radius);padding:12px 20px;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:12px;min-width:280px;animation:slideIn 0.3s ease;">
        <span style="font-size:1.5rem;">✅</span>
        <span>Order completed successfully!</span>
      </div>
      <div class="toast" style="background:var(--card);border-radius:var(--radius);padding:12px 20px;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:12px;min-width:280px;animation:slideIn 0.3s ease;border-left:4px solid var(--warning);">
        <span style="font-size:1.5rem;">⚠️</span>
        <span>Low stock alert: Fries (5 remaining)</span>
      </div>
      <div class="toast" style="background:var(--card);border-radius:var(--radius);padding:12px 20px;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:12px;min-width:280px;animation:slideIn 0.3s ease;border-left:4px solid var(--danger);">
        <span style="font-size:1.5rem;">❌</span>
        <span>Failed to connect to server</span>
      </div>
      <style>
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
      </style>
    </div>
  `,
};