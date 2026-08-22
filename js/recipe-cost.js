/**
 * RecipeCost – Profitability & Cost Tracking for Menu Items
 *
 * Integrates as a "Profitability" tab within the Reports page.
 * Uses menu_items.cost_price and menu_sizes.cost_price (migration 012).
 */
const RecipeCost = (() => {
    let sortColumn = 'name';
    let sortDirection = 'asc';
    let filterCategory = '';
    let searchTerm = '';

    function render() {
        const el = document.getElementById('page-reports');
        if (!el) return;

        // Check if we should show the Profitability tab (admin only)
        if (!Auth.isAdmin()) {
            Reports.render();
            return;
        }

        // Build combined items with cost/price data
        const items = buildItemData();
        const categories = DB.getAll('categories').filter(c => c.enabled);
        const filteredItems = applyFilters(items);

        // Summary stats
        const stats = calculateStats(items);

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Sales Reports</h3>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <div class="btn-group" role="tablist" aria-label="Report tabs">
                            <button class="btn btn-sm ${reportType !== 'profitability' ? 'btn-outline' : 'btn-primary'}" id="rptDaily" role="tab" aria-selected="${reportType !== 'profitability'}">Daily</button>
                            <button class="btn btn-sm ${reportType !== 'profitability' ? 'btn-outline' : 'btn-primary'}" id="rptMonthly" role="tab" aria-selected="${reportType !== 'profitability'}">Monthly</button>
                            <button class="btn btn-sm ${reportType !== 'profitability' ? 'btn-outline' : 'btn-primary'}" id="rptCustom" role="tab" aria-selected="${reportType !== 'profitability'}">Custom Range</button>
                            <button class="btn btn-sm ${reportType === 'profitability' ? 'btn-primary' : 'btn-outline'}" id="rptProfitability" role="tab" aria-selected="${reportType === 'profitability'}">📊 Profitability</button>
                        </div>
                        ${Auth.isAdmin() ? `
                            <select class="form-control" id="rptCashier" style="width:180px;">
                                <option value="">All Cashiers</option>
                                ${DB.getAll('users')
                                    .filter(u => u.role === 'cashier' && u.enabled !== false)
                                    .map(u => `<option value="${u.id}" ${filterCashier === u.id ? 'selected' : ''}>${App.escapeHtml(u.name)}</option>`)
                                    .join('')}
                            </select>
                        ` : ''}
                        <input type="date" class="form-control" id="rptDateFrom" value="${filterDateFrom}" style="width:150px;">
                        <span class="text-muted">to</span>
                        <input type="date" class="form-control" id="rptDateTo" value="${filterDateTo}" style="width:150px;">
                        <button class="btn btn-primary btn-sm" id="rptApply">Apply</button>
                    </div>
                </div>
                <div class="card-body">
                    ${reportType === 'profitability' ? renderProfitabilityTab(filteredItems, categories, stats) : renderSalesReport()}
                </div>
            </div>
        `;

        bindEvents(el, filteredItems, categories);
    }

    // Track which report tab is active
    let reportType = 'daily';
    let filterDateFrom = '';
    let filterDateTo = '';
    let filterCashier = '';

    function renderProfitabilityTab(items, categories, stats) {
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        // Summary cards
        const summaryCards = `
            <div class="report-summary" style="margin-bottom:20px;">
                <div class="stat-card">
                    <div class="stat-icon blue">📊</div>
                    <div class="stat-info">
                        <div class="stat-label">Avg Margin</div>
                        <div class="stat-value" style="color:${stats.avgMargin >= 60 ? 'var(--success)' : stats.avgMargin >= 30 ? 'var(--warning)' : 'var(--danger)'}">${stats.avgMargin.toFixed(1)}%</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">🏆</div>
                    <div class="stat-info">
                        <div class="stat-label">Most Profitable</div>
                        <div class="stat-value" title="${App.escapeHtml(stats.mostProfitable?.name || '—')}">${App.escapeHtml(stats.mostProfitable?.name || '—')}</div>
                        <div class="text-muted" style="font-size:0.75rem;">${stats.mostProfitable ? App.formatCurrency(stats.mostProfitable.sellPrice) + ' • ' + stats.mostProfitable.margin.toFixed(1) + '%' : '—'}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">⚠️</div>
                    <div class="stat-info">
                        <div class="stat-label">Least Profitable</div>
                        <div class="stat-value" title="${App.escapeHtml(stats.leastProfitable?.name || '—')}">${App.escapeHtml(stats.leastProfitable?.name || '—')}</div>
                        <div class="text-muted" style="font-size:0.75rem;">${stats.leastProfitable ? App.formatCurrency(stats.leastProfitable.sellPrice) + ' • ' + stats.leastProfitable.margin.toFixed(1) + '%' : '—'}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon purple">💰</div>
                    <div class="stat-info">
                        <div class="stat-label">Total Potential Profit</div>
                        <div class="stat-value">${App.formatCurrency(stats.totalPotentialProfit)}</div>
                        <div class="text-muted" style="font-size:0.75rem;">Based on current costs & prices</div>
                    </div>
                </div>
            </div>
        `;

        // Target Margin Calculator
        const targetMarginCalc = `
            <div class="card" style="margin-bottom:20px;background:var(--bg);border:1px solid var(--border);">
                <div class="card-header">
                    <h4>🎯 Target Margin Calculator</h4>
                </div>
                <div class="card-body" style="display:flex;gap:16px;flex-wrap:wrap;align-items:end;">
                    <div class="form-group" style="margin-bottom:0;">
                        <label>Target Margin %</label>
                        <input type="number" class="form-control" id="targetMarginInput" placeholder="e.g. 60" step="1" min="0" max="99" style="width:120px;">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label>Cost Price</label>
                        <input type="number" class="form-control" id="targetCostInput" placeholder="e.g. 5.00" step="0.01" min="0" style="width:140px;">
                    </div>
                    <div style="display:flex;gap:8px;align-items:end;">
                        <button class="btn btn-primary" id="btnCalcTarget">Calculate Sell Price</button>
                        <button class="btn btn-outline" id="btnClearTarget">Clear</button>
                    </div>
                    <div id="targetResult" style="margin-top:12px;padding:12px;background:var(--bg-elevated);border-radius:8px;display:none;">
                        <strong>Suggested Sell Price: <span id="targetSellPrice" style="color:var(--primary);"></span></strong>
                        <span class="text-muted" style="margin-left:16px;">(Margin: <span id="targetActualMargin"></span>%)</span>
                    </div>
                </div>
            </div>
        `;

        // Filters row
        const filtersRow = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px;padding:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                <div class="form-group" style="margin-bottom:0;">
                    <label>Category</label>
                    <select class="form-control" id="profitCatFilter" style="width:180px;">
                        <option value="">All Categories</option>
                        ${categories.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${App.escapeHtml(c.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <label>Search</label>
                    <input type="text" class="form-control" id="profitSearch" placeholder="Search items..." value="${App.escapeHtml(searchTerm)}" style="width:200px;">
                </div>
                <button class="btn btn-outline" id="btnExportCsv" style="margin-top:24px;">⬇ Export CSV</button>
            </div>
        `;

        // Table
        const tableHtml = items.length > 0
            ? `
                <div class="table-container">
                    <table id="profitTable">
                        <thead>
                            <tr>
                                <th data-sort="name" class="sortable ${sortColumn === 'name' ? sortDirection : ''}">Name ${sortColumn === 'name' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                                <th data-sort="category" class="sortable ${sortColumn === 'category' ? sortDirection : ''}">Category ${sortColumn === 'category' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                                <th data-sort="sellPrice" class="sortable ${sortColumn === 'sellPrice' ? sortDirection : ''}" style="text-align:right;">Sell Price ${sortColumn === 'sellPrice' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                                <th data-sort="costPrice" class="sortable ${sortColumn === 'costPrice' ? sortDirection : ''}" style="text-align:right;">Cost Price ${sortColumn === 'costPrice' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                                <th data-sort="margin" class="sortable ${sortColumn === 'margin' ? sortDirection : ''}" style="text-align:right;">Margin % ${sortColumn === 'margin' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                                <th>Status</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(item => renderItemRow(item, catMap)).join('')}
                        </tbody>
                    </table>
                </div>
            `
            : '<div class="empty-state"><span class="icon">📊</span><h3>No menu items found</h3><p>Add menu items or adjust filters.</p></div>';

        return summaryCards + targetMarginCalc + filtersRow + tableHtml;
    }

    function renderSalesReport() {
        // Placeholder - will be replaced by Reports.render() when switching tabs
        return `
            <div class="report-summary">
                <div class="stat-card"><div class="stat-icon green">💵</div><div class="stat-info"><div class="stat-label">Total Revenue</div><div class="stat-value">—</div></div></div>
                <div class="stat-card"><div class="stat-icon blue">📦</div><div class="stat-info"><div class="stat-label">Orders</div><div class="stat-value">—</div></div></div>
                <div class="stat-card"><div class="stat-icon purple">📊</div><div class="stat-info"><div class="stat-label">Avg Order Value</div><div class="stat-value">—</div></div></div>
                <div class="stat-card"><div class="stat-icon orange">💰</div><div class="stat-info"><div class="stat-label">Tax Collected</div><div class="stat-value">—</div></div></div>
            </div>
            <div class="empty-state"><span class="icon">📈</span><h3>Select a report tab above</h3></div>
        `;
    }

    function buildItemData() {
        const menuItems = DB.getAll('menu_items');
        const menuSizes = DB.getAll('menu_sizes');
        const categories = DB.getAll('categories');
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        return menuItems.map(item => {
            const sizes = menuSizes.filter(s => s.menuItemId === item.id);

            // Get sell price: min of sizes, or 0
            const prices = sizes.map(s => parseFloat(s.price) || 0);
            const minSellPrice = prices.length ? Math.min(...prices) : 0;
            const maxSellPrice = prices.length ? Math.max(...prices) : 0;

            // Get cost price: check sizes first, then item-level
            let costPrice = 0;
            let costSource = 'none';

            // If any size has cost_price > 0, use the min of those
            const sizeCosts = sizes
                .filter(s => parseFloat(s.cost_price) > 0)
                .map(s => parseFloat(s.cost_price));
            if (sizeCosts.length > 0) {
                costPrice = Math.min(...sizeCosts);
                costSource = 'size';
            } else if (parseFloat(item.cost_price) > 0) {
                costPrice = parseFloat(item.cost_price);
                costSource = 'item';
            }

            const margin = minSellPrice > 0 && costPrice > 0
                ? ((minSellPrice - costPrice) / minSellPrice) * 100
                : null;

            return {
                id: item.id,
                name: item.name,
                description: item.description,
                categoryId: item.categoryId,
                categoryName: catMap[item.categoryId] || '—',
                enabled: item.enabled,
                sellPrice: minSellPrice,
                maxSellPrice: maxSellPrice,
                costPrice: costPrice,
                costSource: costSource,
                margin: margin,
                sizes: sizes.map(s => ({
                    id: s.id,
                    name: s.name,
                    price: parseFloat(s.price) || 0,
                    costPrice: parseFloat(s.cost_price) || 0,
                })),
            };
        });
    }

    function applyFilters(items) {
        let filtered = [...items];

        if (filterCategory) {
            filtered = filtered.filter(i => i.categoryId === filterCategory);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(i =>
                i.name.toLowerCase().includes(term) ||
                i.categoryName.toLowerCase().includes(term)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            let aVal = a[sortColumn];
            let bVal = b[sortColumn];

            if (sortColumn === 'category') {
                aVal = a.categoryName;
                bVal = b.categoryName;
            }

            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }

            // Handle null margins (sort to bottom)
            if (aVal === null && bVal === null) return 0;
            if (aVal === null) return 1;
            if (bVal === null) return -1;

            const cmp = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            return sortDirection === 'asc' ? cmp : -cmp;
        });

        return filtered;
    }

    function calculateStats(items) {
        const withMargin = items.filter(i => i.margin !== null && i.margin !== undefined);

        const avgMargin = withMargin.length
            ? withMargin.reduce((sum, i) => sum + i.margin, 0) / withMargin.length
            : 0;

        const sortedByMargin = [...withMargin].sort((a, b) => b.margin - a.margin);
        const mostProfitable = sortedByMargin[0] || null;
        const leastProfitable = sortedByMargin[sortedByMargin.length - 1] || null;

        // Total potential profit: sum of (sell - cost) for all items with both prices
        const totalPotentialProfit = items
            .filter(i => i.sellPrice > 0 && i.costPrice > 0)
            .reduce((sum, i) => sum + (i.sellPrice - i.costPrice), 0);

        return { avgMargin, mostProfitable, leastProfitable, totalPotentialProfit };
    }

    function renderItemRow(item, catMap) {
        const margin = item.margin;
        let statusClass = 'badge-gray';
        let statusText = 'No cost set';

        if (margin !== null && margin !== undefined) {
            if (margin > 60) { statusClass = 'badge-success'; statusText = 'Excellent'; }
            else if (margin >= 30) { statusClass = 'badge-warning'; statusText = 'Good'; }
            else { statusClass = 'badge-danger'; statusText = 'Low'; }
        }

        const costDisplay = item.costPrice > 0
            ? App.formatCurrency(item.costPrice) + (item.costSource === 'size' ? ' <span class="text-muted" style="font-size:0.7rem;">(size)</span>' : '')
            : '<span class="text-muted">—</span>';

        const marginDisplay = margin !== null && margin !== undefined
            ? `<strong style="color:${margin > 60 ? 'var(--success)' : margin >= 30 ? 'var(--warning)' : 'var(--danger)'}">${margin.toFixed(1)}%</strong>`
            : '<span class="text-muted">—</span>';

        return `
            <tr>
                <td>
                    <strong>${App.escapeHtml(item.name)}</strong>
                    ${item.description ? `<br><small class="text-muted">${App.escapeHtml(item.description)}</small>` : ''}
                </td>
                <td><span class="badge badge-purple">${App.escapeHtml(item.categoryName)}</span></td>
                <td style="text-align:right;">${App.formatCurrency(item.sellPrice)}${item.maxSellPrice > item.sellPrice ? ` <span class="text-muted" style="font-size:0.75rem;">– ${App.formatCurrency(item.maxSellPrice)}</span>` : ''}</td>
                <td style="text-align:right;">${costDisplay}</td>
                <td style="text-align:right;">${marginDisplay}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td style="text-align:right;">
                    <div class="btn-group" style="justify-content:flex-end;">
                        <button class="btn btn-outline btn-sm" data-action="set-cost" data-id="${item.id}" title="Set Cost Prices">💲 Set Cost</button>
                        ${item.sizes.length > 1 ? `<button class="btn btn-ghost btn-sm" data-action="view-sizes" data-id="${item.id}" title="View Size Details">📏 Sizes</button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    function bindEvents(el, items, categories) {
        // Report tab buttons
        const dailyBtn = document.getElementById('rptDaily');
        const monthlyBtn = document.getElementById('rptMonthly');
        const customBtn = document.getElementById('rptCustom');
        const profitBtn = document.getElementById('rptProfitability');
        const applyBtn = document.getElementById('rptApply');
        const cashierSelect = document.getElementById('rptCashier');
        const dateFrom = document.getElementById('rptDateFrom');
        const dateTo = document.getElementById('rptDateTo');

        const switchToProfitability = () => {
            reportType = 'profitability';
            render();
        };

        const switchToSales = (type) => {
            reportType = type;
            // Reset date filters for sales reports
            const today = new Date().toISOString().split('T')[0];
            if (type === 'daily') {
                filterDateFrom = today;
                filterDateTo = today;
            } else if (type === 'monthly') {
                const d = new Date();
                filterDateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                filterDateTo = today;
            }
            // Delegate to Reports module
            Reports.render();
        };

        if (dailyBtn) dailyBtn.addEventListener('click', () => switchToSales('daily'));
        if (monthlyBtn) monthlyBtn.addEventListener('click', () => switchToSales('monthly'));
        if (customBtn) customBtn.addEventListener('click', () => switchToSales('custom'));
        if (profitBtn) profitBtn.addEventListener('click', switchToProfitability);

        if (applyBtn) applyBtn.addEventListener('click', () => {
            filterDateFrom = dateFrom?.value || '';
            filterDateTo = dateTo?.value || '';
            filterCashier = cashierSelect?.value || '';
            if (reportType === 'profitability') {
                render();
            } else {
                Reports.render();
            }
        });

        if (cashierSelect) cashierSelect.addEventListener('change', (e) => {
            filterCashier = e.target.value;
        });

        // Profitability-specific events
        const catFilter = document.getElementById('profitCatFilter');
        const searchInput = document.getElementById('profitSearch');
        const exportBtn = document.getElementById('btnExportCsv');
        const calcBtn = document.getElementById('btnCalcTarget');
        const clearTargetBtn = document.getElementById('btnClearTarget');
        const targetMarginInput = document.getElementById('targetMarginInput');
        const targetCostInput = document.getElementById('targetCostInput');

        if (catFilter) catFilter.addEventListener('change', (e) => {
            filterCategory = e.target.value;
            render();
        });

        if (searchInput) searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value;
            render();
        });

        if (exportBtn) exportBtn.addEventListener('click', () => exportCsv(items));

        // Target margin calculator
        if (calcBtn) calcBtn.addEventListener('click', () => {
            const targetMargin = parseFloat(targetMarginInput?.value) || 0;
            const cost = parseFloat(targetCostInput?.value) || 0;

            if (targetMargin <= 0 || targetMargin >= 100) {
                App.toast('Enter a valid margin (1-99%)', 'error');
                return;
            }
            if (cost <= 0) {
                App.toast('Enter a valid cost price', 'error');
                return;
            }

            // sell = cost / (1 - margin/100)
            const sellPrice = cost / (1 - targetMargin / 100);
            const actualMargin = ((sellPrice - cost) / sellPrice) * 100;

            document.getElementById('targetSellPrice').textContent = App.formatCurrency(sellPrice);
            document.getElementById('targetActualMargin').textContent = actualMargin.toFixed(1);
            document.getElementById('targetResult').style.display = 'block';
        });

        if (clearTargetBtn) clearTargetBtn.addEventListener('click', () => {
            targetMarginInput.value = '';
            targetCostInput.value = '';
            document.getElementById('targetResult').style.display = 'none';
        });

        // Sortable headers
        el.querySelectorAll('#profitTable th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sortColumn === col) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = col;
                    sortDirection = 'asc';
                }
                render();
            });
        });

        // Action buttons: Set Cost
        el.querySelectorAll('[data-action="set-cost"]').forEach(btn => {
            btn.addEventListener('click', () => openCostModal(btn.dataset.id));
        });

        // Action buttons: View Sizes
        el.querySelectorAll('[data-action="view-sizes"]').forEach(btn => {
            btn.addEventListener('click', () => openSizeDetailModal(btn.dataset.id));
        });
    }

    function openCostModal(itemId) {
        const item = DB.getById('menu_items', itemId);
        if (!item) return;

        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId);
        const categories = DB.getAll('categories');

        App.openModal(`
            <div class="modal-header">
                <h3>💲 Set Cost Prices — ${App.escapeHtml(item.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p class="text-muted" style="margin-bottom:16px;">Set cost prices for this item and its sizes. Item-level cost is used as fallback when size cost is not set.</p>

                <div class="form-group">
                    <label>Item-Level Cost Price (fallback)</label>
                    <div style="display:flex;gap:8px;align-items:end;">
                        <input type="number" class="form-control" id="itemCostPrice" value="${item.cost_price > 0 ? item.cost_price : ''}" placeholder="0.00" step="0.01" min="0" style="flex:1;">
                        <span class="text-muted" style="font-size:0.8rem;">Used when size has no cost</span>
                    </div>
                </div>

                <h4 style="margin:20px 0 12px;font-size:0.95rem;">Size-Specific Costs</h4>
                <div id="costSizesContainer">
                    ${sizes.length > 0 ? sizes.map((s, i) => costSizeRow(s, i)).join('') : '<p class="text-muted">No sizes defined for this item.</p>'}
                </div>

                ${sizes.length > 0 ? `
                    <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:8px;">
                        <strong>Quick Fill:</strong>
                        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                            <button class="btn btn-outline btn-sm" id="fillAllCosts">Fill All with Item Cost</button>
                            <button class="btn btn-outline btn-sm" id="clearAllCosts">Clear All Size Costs</button>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btnSaveCosts">Save Costs</button>
            </div>
        `);

        // Bind quick fill buttons
        const fillBtn = document.getElementById('fillAllCosts');
        const clearBtn = document.getElementById('clearAllCosts');

        if (fillBtn) fillBtn.addEventListener('click', () => {
            const itemCost = parseFloat(document.getElementById('itemCostPrice').value) || 0;
            if (itemCost <= 0) { App.toast('Set item cost first', 'error'); return; }
            document.querySelectorAll('.size-cost-input').forEach(input => {
                input.value = itemCost.toFixed(2);
            });
        });

        if (clearBtn) clearBtn.addEventListener('click', () => {
            document.querySelectorAll('.size-cost-input').forEach(input => {
                input.value = '';
            });
        });

        // Save
        document.getElementById('btnSaveCosts').addEventListener('click', () => {
            const itemCost = parseFloat(document.getElementById('itemCostPrice').value) || 0;

            // Update item-level cost
            if (itemCost !== parseFloat(item.cost_price || 0)) {
                DB.update('menu_items', itemId, { cost_price: itemCost });
            }

            // Update size costs
            const sizeRows = document.querySelectorAll('.cost-size-row');
            sizeRows.forEach(row => {
                const sizeId = row.dataset.sizeId;
                const cost = parseFloat(row.querySelector('.size-cost-input').value) || 0;
                const size = DB.getById('menu_sizes', sizeId);
                if (size && cost !== parseFloat(size.cost_price || 0)) {
                    DB.update('menu_sizes', sizeId, { cost_price: cost });
                }
            });

            DB.logAction('recipe_cost_update', 'menu_items', itemId, { itemCost, sizes: sizes.map(s => s.id) });
            App.toast('Cost prices saved');
            App.closeModal();
            render();
        });

        document.getElementById('itemCostPrice').focus();
    }

    function costSizeRow(size, index) {
        return `
            <div class="form-row cost-size-row" data-size-id="${size.id}" style="margin-bottom:10px;align-items:end;">
                <div class="form-group" style="margin-bottom:0;flex:1;">
                    <label>${App.escapeHtml(size.name)}</label>
                    <input type="number" class="form-control size-cost-input" value="${size.cost_price > 0 ? size.cost_price : ''}" placeholder="0.00" step="0.01" min="0">
                </div>
                <div class="form-group" style="margin-bottom:0;flex:1;">
                    <label>Sell Price</label>
                    <input type="number" class="form-control" value="${size.price}" readonly style="background:var(--bg);color:var(--text-muted);">
                </div>
                <div class="form-group" style="margin-bottom:0;flex:1;">
                    <label>Margin</label>
                    <input type="text" class="form-control size-margin-display" value="${calculateSizeMargin(size.price, size.cost_price)}" readonly style="background:var(--bg);text-align:center;">
                </div>
            </div>
        `;
    }

    function calculateSizeMargin(price, cost) {
        const p = parseFloat(price) || 0;
        const c = parseFloat(cost) || 0;
        if (p <= 0 || c <= 0) return '—';
        return ((p - c) / p * 100).toFixed(1) + '%';
    }

    function openSizeDetailModal(itemId) {
        const item = DB.getById('menu_items', itemId);
        const sizes = DB.query('menu_sizes', s => s.menuItemId === itemId);

        if (!item || sizes.length === 0) return;

        App.openModal(`
            <div class="modal-header">
                <h3>📏 Size Details — ${App.escapeHtml(item.name)}</h3>
                <button class="modal-close" onclick="App.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="table-container" style="max-height:400px;overflow-y:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Size</th>
                                <th style="text-align:right;">Sell Price</th>
                                <th style="text-align:right;">Cost Price</th>
                                <th style="text-align:right;">Margin %</th>
                                <th style="text-align:right;">Profit/Unit</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sizes.map(s => {
                                const price = parseFloat(s.price) || 0;
                                const cost = parseFloat(s.cost_price) || 0;
                                const margin = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null;
                                const profit = price - cost;
                                let marginClass = '';
                                let marginText = '—';
                                if (margin !== null) {
                                    if (margin > 60) marginClass = 'style="color:var(--success)"';
                                    else if (margin >= 30) marginClass = 'style="color:var(--warning)"';
                                    else marginClass = 'style="color:var(--danger)"';
                                    marginText = margin.toFixed(1) + '%';
                                }
                                return `
                                    <tr>
                                        <td><strong>${App.escapeHtml(s.name)}</strong></td>
                                        <td style="text-align:right;">${App.formatCurrency(price)}</td>
                                        <td style="text-align:right;">${cost > 0 ? App.formatCurrency(cost) : '<span class="text-muted">—</span>'}</td>
                                        <td style="text-align:right;" ${marginClass}>${marginText}</td>
                                        <td style="text-align:right;">${cost > 0 ? App.formatCurrency(profit) : '<span class="text-muted">—</span>'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="App.closeModal()">Close</button>
            </div>
        `);
    }

    function exportCsv(items) {
        const categories = DB.getAll('categories');
        const catMap = {};
        categories.forEach(c => catMap[c.id] = c.name);

        const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

        const headers = [
            'Item Name', 'Category', 'Min Sell Price', 'Max Sell Price',
            'Item Cost Price', 'Size Cost (min)', 'Margin %', 'Status'
        ];

        const rows = items.map(item => {
            const sizeCosts = item.sizes.filter(s => s.costPrice > 0).map(s => s.costPrice);
            const minSizeCost = sizeCosts.length ? Math.min(...sizeCosts) : 0;

            let status = 'No cost set';
            if (item.margin !== null && item.margin !== undefined) {
                if (item.margin > 60) status = 'Excellent';
                else if (item.margin >= 30) status = 'Good';
                else status = 'Low';
            }

            return [
                escape(item.name),
                escape(catMap[item.categoryId] || '—'),
                item.sellPrice.toFixed(2),
                item.maxSellPrice.toFixed(2),
                item.costPrice.toFixed(2),
                minSizeCost.toFixed(2),
                item.margin !== null ? item.margin.toFixed(1) : '',
                escape(status),
            ];
        });

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `profitability-report-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        App.toast('CSV exported');
    }

    // Initialize with default date range for sales reports
    const today = new Date().toISOString().split('T')[0];
    if (!filterDateFrom) {
        filterDateFrom = today;
        filterDateTo = today;
    }

    return { render };
})();