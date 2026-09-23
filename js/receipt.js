/**
 * Receipt – Thermal receipt generation and printing
 */
const Receipt = (() => {
    function show(order) {
        if (!order) return;

        const items = DB.query('order_items', i => i.orderId === order.id);
        const restaurantName = DB.getSetting('restaurant_name') || 'ZE-POS';
        const address = DB.getSetting('restaurant_address') || '';
        const phone = DB.getSetting('restaurant_phone') || '';
        const logo = DB.getSetting('receipt_logo') || '';
        const accentColor = DB.getSetting('receipt_accent_color') || '#000000';
        const footerMsg = DB.getSetting('receipt_footer_message') || 'Thank you for your order!\nPlease visit us again.';

        const receiptHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Receipt #${order.orderNumber}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; background: #fff; }
        .receipt { width: 280px; margin: 0 auto; padding: 10px; }
        .receipt-header { text-align: center; margin-bottom: 8px; }
        .receipt-header img { max-width: 200px; max-height: 90px; margin-bottom: 6px; }
        .receipt-header h1 { font-size: 18px; margin-bottom: 2px; }
        .receipt-header p { font-size: 11px; color: #555; line-height: 1.4; }
        .divider { border: none; border-top: 1px dashed ${accentColor}; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; padding: 2px 0; }
        .row.bold { font-weight: bold; }
        .item-block { margin-bottom: 8px; }
        .item-name { font-weight: bold; }
        .item-meta { font-size: 11px; color: #555; margin-left: 10px; }
        .total-section { border-top: 2px solid ${accentColor}; margin-top: 8px; padding-top: 8px; }
        .total-section .row { font-weight: bold; font-size: 14px; color: ${accentColor}; }
        .receipt-footer { text-align: center; margin-top: 12px; font-size: 11px; }
        @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="receipt">
        <div class="receipt-header">
            ${logo ? `<img src="${logo}" alt="${escapeHtml(restaurantName)}">` : `<h1>${escapeHtml(restaurantName)}</h1>`}
            ${address ? `<p>${escapeHtml(address)}</p>` : ''}
            ${phone ? `<p>${escapeHtml(phone)}</p>` : ''}
            <p style="margin-top:4px;">Tel: ${escapeHtml(phone)}</p>
        </div>
        <hr class="divider">
        <div class="row"><span>Invoice:</span><span>#${order.orderNumber}</span></div>
        <div class="row"><span>Date:</span><span>${formatDateShort(order.createdAt)}</span></div>
        <div class="row"><span>Cashier:</span><span>${escapeHtml(order.userName || '—')}</span></div>
        <div class="row"><span>Order Type:</span><span>${escapeHtml(order.type)}</span></div>
        ${order.payment_method ? `
        <div class="row"><span>Payment Method:</span><span>${escapeHtml(order.payment_method === 'cash' ? 'Cash' : 'Gcash')}</span></div>
        ${order.payment_reference ? `
        <div class="row"><span>Payment Reference:</span><span>${escapeHtml(order.payment_reference)}</span></div>
        ` : ''}
        ` : ''}
        <hr class="divider">

        ${items.map(item => `
            <div class="item-block">
                <div class="row">
                    <span class="item-name">${escapeHtml(item.name)}</span>
                    <span>${formatCurrency(item.lineTotal)}</span>
                </div>
                <div class="item-meta">
                    ${item.size ? escapeHtml(item.size) : ''} x${item.quantity} @ ${formatCurrency(item.unitPrice)}
                </div>
                ${item.condiments && item.condiments.length ? `
                    <div class="item-meta">+ ${item.condiments.map(c => escapeHtml(c.name)).join(', ')}</div>
                ` : ''}
                ${item.notes ? `<div class="item-meta">📝 ${escapeHtml(item.notes)}</div>` : ''}
            </div>
        `).join('')}

        <hr class="divider">
        <div class="total-section">
            <div class="row"><span>Subtotal:</span><span>${formatCurrency(order.subtotal)}</span></div>
            <div class="row"><span>${escapeHtml(order.taxName || 'Tax')} (${order.taxPercentage || 0}%):</span><span>${formatCurrency(order.taxAmount)}</span></div>
            <div class="row" style="font-size:15px;margin-top:4px;"><span>TOTAL:</span><span>${formatCurrency(order.total)}</span></div>
        </div>
        <hr class="divider">

        <div class="receipt-footer">
            ${footerMsg.split('\n').map(line => `<p>${escapeHtml(line)}</p>`).join('')}
        </div>
    </div>
    <script>window.onload = function() { window.print(); }</script>
</body>
</html>
        `;

        const win = window.open('', '_blank', 'width=320,height=600');
        if (win) {
            win.document.write(receiptHtml);
            win.document.close();
        } else {
            App.toast('Please allow popups to print receipts', 'warning');
        }
    }

    function showShift(shift) {
        if (!shift) return;

        const orders = DB.query('orders', o => o.shiftId === shift.id)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const totalSales = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
        const restaurantName = DB.getSetting('restaurant_name') || 'ZE-POS';
        const address = DB.getSetting('restaurant_address') || '';
        const phone = DB.getSetting('restaurant_phone') || '';
        const logo = DB.getSetting('receipt_logo') || '';
        const accentColor = DB.getSetting('receipt_accent_color') || '#000000';

        // Hours worked (live for an open shift) + daily OT for the shift's start date
        const endIso = shift.endTime || new Date().toISOString();
        const hoursWorked = Payroll.hoursForShift({ startTime: shift.startTime, endTime: endIso });
        const otHours = shift.startTime ? Payroll.dailyOtForDate(shift.userId, shift.startTime.split('T')[0]) : 0;
        const status = shift.status === 'open' ? 'Open' : 'Closed';

        const shiftHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Shift Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; background: #fff; }
        .receipt { width: 280px; margin: 0 auto; padding: 10px; }
        .receipt-header { text-align: center; margin-bottom: 8px; }
        .receipt-header img { max-width: 200px; max-height: 90px; margin-bottom: 6px; }
        .receipt-header h1 { font-size: 18px; margin-bottom: 2px; }
        .receipt-header p { font-size: 11px; color: #555; line-height: 1.4; }
        .divider { border: none; border-top: 1px dashed ${accentColor}; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; padding: 2px 0; }
        .row.bold { font-weight: bold; }
        .item-block { margin-bottom: 8px; }
        .item-name { font-weight: bold; }
        .item-meta { font-size: 11px; color: #555; margin-left: 10px; }
        .total-section { border-top: 2px solid ${accentColor}; margin-top: 8px; padding-top: 8px; }
        .total-section .row { font-weight: bold; font-size: 14px; color: ${accentColor}; }
        .receipt-footer { text-align: center; margin-top: 12px; font-size: 11px; }
    </style>
</head>
<body>
    <div class="receipt">
        <div class="receipt-header">
            ${logo ? `<img src="${logo}" alt="${escapeHtml(restaurantName)}">` : `<h1>${escapeHtml(restaurantName)}</h1>`}
            ${address ? `<p>${escapeHtml(address)}</p>` : ''}
            <p>Shift Report — ${status}</p>
        </div>
        <hr class="divider">
        <div class="row"><span>Cashier:</span><span>${escapeHtml(shift.userName || '—')}</span></div>
        <div class="row"><span>Started:</span><span>${formatDateShort(shift.startTime)}</span></div>
        <div class="row"><span>Ended:</span><span>${shift.endTime ? formatDateShort(shift.endTime) : 'Still open'}</span></div>
        <div class="row"><span>Hours Worked:</span><span>${hoursWorked.toFixed(2)}h</span></div>
        <div class="row"><span>OT Hours (day):</span><span>${otHours > 0 ? otHours.toFixed(2) + 'h' : '0h'}</span></div>
        <hr class="divider">
        <div class="row"><span>Orders:</span><span>${orders.length}</span></div>
        <div class="row"><span>Starting Cash:</span><span>${formatCurrency(shift.startingCash || 0)}</span></div>
        <div class="row"><span>Ending Cash:</span><span>${shift.endingCash != null ? formatCurrency(shift.endingCash) : '—'}</span></div>
        <div class="row"><span>Cash Diff:</span><span>${shift.cashDifference != null ? formatCurrency(shift.cashDifference) : '—'}</span></div>
        <hr class="divider">
        <div class="row bold" style="color:${accentColor};"><span>Total Sales:</span><span>${formatCurrency(shift.totalSales != null ? shift.totalSales : totalSales)}</span></div>
        ${shift.status === 'closed' && shift.expenses && shift.expenses.length ? `
            <hr class="divider">
            ${shift.expenses.map(exp => `
                <div class="row"><span>Exp: ${escapeHtml(exp.description || 'Expense')}</span><span>-${formatCurrency(exp.amount)}</span></div>
            `).join('')}
            <div class="row"><span>Total Expenses:</span><span>-${formatCurrency(shift.totalExpenses || 0)}</span></div>
        ` : ''}
        ${shift.status === 'closed' ? `
            <hr class="divider">
            <div class="row bold" style="color:${accentColor};"><span>Net Sales:</span><span>${formatCurrency(shift.netSales != null ? shift.netSales : totalSales)}</span></div>
        ` : ''}
        ${orders.length ? `
            <hr class="divider">
            ${orders.map(o => `
                <div class="item-block">
                    <div class="row"><span class="item-name">#${o.orderNumber} (${escapeHtml(o.type)})</span><span>${formatCurrency(o.total)}</span></div>
                    <div class="item-meta">${formatDateShort(o.createdAt)}</div>
                </div>
            `).join('')}
        ` : ''}
        <div class="receipt-footer">
            <p>End of shift report</p>
        </div>
    </div>
    <script>window.onload = function() { window.print(); }</script>
</body>
</html>
        `;

        const win = window.open('', '_blank', 'width=320,height=600');
        if (win) {
            win.document.write(shiftHtml);
            win.document.close();
        } else {
            App.toast('Please allow popups to print the shift report', 'warning');
        }
    }

    function formatCurrency(amount) {
        const symbol = DB.getSetting('currency_symbol') || '$';
        return symbol + parseFloat(amount || 0).toFixed(2);
    }

    function formatDateShort(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    return { show, showShift };
})();
