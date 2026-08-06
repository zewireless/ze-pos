/**
 * Tax – Configure tax percentage and toggle
 */
const Tax = (() => {
    function render() {
        const el = document.getElementById('page-tax');
        const taxes = DB.getAll('taxes');
        const tax = taxes[0] || { name: 'Sales Tax', percentage: 10, enabled: true };

        el.innerHTML = `
            <div class="card" style="max-width:500px;">
                <div class="card-header">
                    <h3>Tax Configuration</h3>
                </div>
                <div class="card-body">
                    <div class="form-group">
                        <label>Tax Name</label>
                        <input type="text" class="form-control" id="taxName" value="${App.escapeHtml(tax.name)}" placeholder="e.g. Sales Tax, VAT, GST">
                    </div>
                    <div class="form-group">
                        <label>Tax Percentage (%)</label>
                        <input type="number" class="form-control" id="taxPercent" value="${tax.percentage}" step="0.01" min="0" max="100" style="width:160px;">
                    </div>
                    <div class="form-group">
                        <div class="form-check">
                            <input type="checkbox" id="taxEnabled" ${tax.enabled ? 'checked' : ''}>
                            <label for="taxEnabled">Enable Tax</label>
                        </div>
                    </div>

                    <div style="background:var(--bg);padding:16px;border-radius:var(--radius);margin-bottom:20px;">
                        <strong>Preview:</strong>
                        <div class="d-flex justify-between mt-4">
                            <span>Subtotal:</span><span id="previewSubtotal">${App.formatCurrency(100)}</span>
                        </div>
                        <div class="d-flex justify-between">
                            <span>Tax (<span id="previewRate">${tax.percentage}</span>%):</span>
                            <span id="previewTax">${App.formatCurrency(100 * tax.percentage / 100)}</span>
                        </div>
                        <div class="d-flex justify-between font-bold" style="margin-top:8px;padding-top:8px;border-top:2px solid var(--border);">
                            <span>Total:</span>
                            <span id="previewTotal">${App.formatCurrency(100 + 100 * tax.percentage / 100)}</span>
                        </div>
                    </div>

                    <button class="btn btn-primary" id="btnSaveTax">Save Tax Settings</button>
                </div>
            </div>
        `;

        // Live preview
        const percentInput = document.getElementById('taxPercent');
        percentInput.addEventListener('input', updatePreview);

        function updatePreview() {
            const pct = parseFloat(percentInput.value) || 0;
            const sub = 100;
            const taxAmt = sub * pct / 100;
            document.getElementById('previewRate').textContent = pct;
            document.getElementById('previewTax').textContent = App.formatCurrency(taxAmt);
            document.getElementById('previewTotal').textContent = App.formatCurrency(sub + taxAmt);
        }

        document.getElementById('btnSaveTax').addEventListener('click', () => {
            const name = document.getElementById('taxName').value.trim() || 'Sales Tax';
            const percentage = parseFloat(document.getElementById('taxPercent').value) || 0;
            const enabled = document.getElementById('taxEnabled').checked;

            if (taxes.length > 0) {
                DB.update('taxes', taxes[0].id, { name, percentage, enabled });
            } else {
                DB.insert('taxes', { name, percentage, enabled });
            }

            App.toast('Tax settings saved');
        });
    }

    return { render };
})();
