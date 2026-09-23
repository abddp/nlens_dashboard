/**
 * Nealens SaaS Dashboard Controller
 * Orchestrates parallel fetching, skeleton states, date range filters, multi-period curves, and JSON exports.
 */

(function() {
    let currentSince = '';
    let currentUntil = '';
    let currentPrevSince = '';
    let currentPrevUntil = '';

    // Cache of recent API responses for instant resize / theme redraw / JSON export
    const chartDataCache = {
        mrr: null,
        arr: null,
        payingStores: null,
        payingUsers: null,
        signups: null,
        sessions: null,
        activeUsers: null,
        activeStores: null,
        activation: null,
        churn: null,
        retention: null,
        feedback: null,
        timeSpent: null,
        aiUsage: null,
        aiCategories: null,
        topPages: null,
        businessModels: null,
        devices: null,
        geoDistribution: null,
        ttvProduct: null,
        ttvStorefront: null,
        ttvPublish: null,
        ttvPayment: null,
        ttvShipping: null,
        publishRate: null,
        paymentRate: null,
        shippingRate: null
    };

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString();
    }

    function formatCurrency(num) {
        if (num === null || num === undefined || isNaN(num)) return '$0';
        return '$' + Number(num).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function formatDate(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getPresetDates(preset) {
        const today = new Date();
        let sinceDate = new Date();

        if (preset === '7d') {
            sinceDate.setDate(today.getDate() - 7);
        } else if (preset === '30d') {
            sinceDate.setDate(today.getDate() - 30);
        } else if (preset === 'month') {
            sinceDate = new Date(today.getFullYear(), today.getMonth(), 1);
        } else if (preset === 'year') {
            sinceDate = new Date(today.getFullYear(), 0, 1);
        }

        return {
            since: formatDate(sinceDate),
            until: formatDate(today)
        };
    }

    function setKpiSkeleton(kpiId) {
        const valEl = document.getElementById(`kpi-val-${kpiId}`);
        const subEl = document.getElementById(`kpi-sub-${kpiId}`);
        if (valEl) {
            valEl.innerHTML = '<div class="skeleton h-8 w-24 rounded-lg my-1"></div>';
        }
        if (subEl) {
            subEl.innerHTML = '<div class="skeleton h-3.5 w-28 rounded"></div>';
        }
    }

    function setKpiValue(kpiId, formattedValue, subTextHtml) {
        const valEl = document.getElementById(`kpi-val-${kpiId}`);
        const subEl = document.getElementById(`kpi-sub-${kpiId}`);
        if (valEl) {
            valEl.innerHTML = `<span>${formattedValue}</span>`;
        }
        if (subEl && subTextHtml !== undefined) {
            subEl.innerHTML = subTextHtml;
        }
    }

    function setKpiError(kpiId, errorMessage) {
        const valEl = document.getElementById(`kpi-val-${kpiId}`);
        const subEl = document.getElementById(`kpi-sub-${kpiId}`);
        if (valEl) {
            valEl.innerHTML = '<span class="text-rose-500 text-lg font-bold">Erreur</span>';
        }
        if (subEl) {
            subEl.innerHTML = `<span class="text-rose-400 text-[10px] truncate block" title="${errorMessage}">❌ ${errorMessage}</span>`;
        }
    }

    function setChartLoading(chartPrefix) {
        const skeleton = document.getElementById(`${chartPrefix}-chart-skeleton`);
        const container = document.getElementById(`${chartPrefix}-chart-container`);
        if (skeleton) skeleton.classList.remove('hidden');
        if (container) container.classList.add('hidden');
    }

    function setChartLoaded(chartPrefix) {
        const skeleton = document.getElementById(`${chartPrefix}-chart-skeleton`);
        const container = document.getElementById(`${chartPrefix}-chart-container`);
        if (skeleton) skeleton.classList.add('hidden');
        if (container) container.classList.remove('hidden');
    }

    function setChartError(chartPrefix, errorMessage) {
        const skeleton = document.getElementById(`${chartPrefix}-chart-skeleton`);
        const container = document.getElementById(`${chartPrefix}-chart-container`);
        if (skeleton) skeleton.classList.add('hidden');
        if (container) {
            container.classList.remove('hidden');
            container.innerHTML = `<div class="h-full flex items-center justify-center p-4 text-xs text-rose-400 bg-rose-500/10 rounded-xl">❌ ${errorMessage}</div>`;
        }
    }

    function updateVariationBadge(elementId, currentVal, previousVal) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const v = NealensCharts.formatVariation(currentVal, previousVal);
        const colorClass = v.isNeutral ? 'text-[var(--text-faint)]' : (v.isPositive ? 'text-emerald-500' : 'text-rose-500');
        el.innerHTML = `<span class="${colorClass}">${v.text}</span> <span class="text-[var(--text-faint)] font-normal text-[10px]">vs préc.</span>`;
    }

    function renderCohortHeatmap(containerId, cohortData) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!cohortData || !cohortData.cohorts || cohortData.cohorts.length === 0) {
            container.innerHTML = '<div class="h-full flex items-center justify-center p-4 text-xs text-[var(--text-faint)]">Aucune souscription payante enregistrée pour constituer des cohortes.</div>';
            return;
        }

        const cohorts = cohortData.cohorts;
        const maxMonths = cohortData.max_months || Math.max(...cohorts.map(c => c.rates.length));

        let headerCols = '<th class="py-2.5 px-3 text-left font-bold text-[10px] uppercase text-[var(--text-muted)] sticky left-0 bg-[var(--bg-card)]">Cohorte</th>';
        headerCols += '<th class="py-2.5 px-2 text-center font-bold text-[10px] uppercase text-[var(--text-muted)]">Taille</th>';
        for (let i = 0; i < maxMonths; i++) {
            headerCols += `<th class="py-2.5 px-2 text-center font-bold text-[10px] uppercase text-[var(--text-muted)]">M<sub>${i}</sub></th>`;
        }

        const rowsHtml = cohorts.map(c => {
            const smallSampleTag = c.is_small_sample ? '<span class="text-[9px] text-amber-500 font-bold ml-1" title="Échantillon réduit (< 5 boutiques)">*</span>' : '';
            let cells = `<td class="py-2.5 px-3 font-semibold text-xs text-[var(--text-main)] whitespace-nowrap sticky left-0 bg-[var(--bg-card)] border-r border-[var(--border-subtle)]">${c.cohort_label || c.cohort}${smallSampleTag}</td>`;
            cells += `<td class="py-2.5 px-2 text-center font-mono text-xs text-[var(--text-muted)] border-r border-[var(--border-subtle)]">${c.initial_count}</td>`;

            for (let m = 0; m < maxMonths; m++) {
                if (m < c.rates.length) {
                    const rate = c.rates[m];
                    const count = c.counts ? c.counts[m] : Math.round((rate / 100) * c.initial_count);
                    const alpha = Math.max(0.12, (rate / 100) * 0.88);
                    const textColor = alpha > 0.45 ? '#ffffff' : 'var(--text-main)';
                    const sampleNote = c.is_small_sample ? ' • Échantillon indicatif (n < 5)' : '';
                    const cellTooltip = `Cohorte ${c.cohort_label} à M${m} : ${count}/${c.initial_count} boutique(s) (${rate}%)${sampleNote}`;

                    cells += `
                        <td class="p-1 text-center">
                            <div class="py-1.5 px-2 rounded-lg font-bold text-xs transition-transform hover:scale-105 select-none" 
                                 style="background-color: rgba(255, 107, 0, ${alpha}); color: ${textColor};" 
                                 title="${cellTooltip}">
                                ${rate}%
                            </div>
                        </td>
                    `;
                } else {
                    cells += '<td class="p-1 text-center"><div class="py-1.5 px-2 text-[10px] text-[var(--text-faint)] opacity-30">—</div></td>';
                }
            }

            return `<tr class="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-card-raised)] transition-colors">${cells}</tr>`;
        }).join('');

        const warningFooter = cohortData.is_preliminary ? 
            '<div class="pt-2 text-[10px] text-amber-500/80 font-medium text-right flex items-center justify-end gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>* Échantillon préliminaire (< 5 boutiques payantes). Les pourcentages deviendront représentatifs avec le volume.</div>' : '';

        container.innerHTML = `
            <div class="w-full h-full flex flex-col justify-between">
                <div class="w-full overflow-x-auto overflow-y-auto max-h-[220px]">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b border-[var(--border-subtle)]">
                                ${headerCols}
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
                ${warningFooter}
            </div>
        `;
    }

    function isNeeded(...selectors) {
        return selectors.some(s => {
            if (!s) return false;
            if (s.startsWith('#') || s.startsWith('.')) {
                return document.querySelector(s) !== null;
            }
            return document.getElementById(s) !== null 
                || document.getElementById(`kpi-val-${s}`) !== null
                || document.getElementById(`${s}-chart-container`) !== null
                || document.querySelector(`[data-kpi="${s}"]`) !== null
                || document.querySelector(`[data-kpi-card="${s}"]`) !== null;
        });
    }

    function setAllSkeletons() {
        ['revenue', 'users', 'paying-stores', 'paying-users', 'churn', 'feedback', 'time-spent', 'ai-credits', 'created-shops'].forEach(k => {
            if (document.getElementById(`kpi-val-${k}`) || document.querySelector(`[data-kpi="${k}"]`)) {
                setKpiSkeleton(k);
            }
        });

        const charts = [
            'mrr', 'arr', 'paying-stores', 'paying-users', 'signups', 'sessions',
            'active-users', 'active-stores', 'activation', 'churn', 'retention',
            'created-shops', 'ai-usage', 'ai-categories', 'top-pages', 'business-models', 'devices', 'geo-distribution',
            'ttv-product', 'publish-rate', 'ttv-storefront', 'ttv-publish',
            'payment-rate', 'ttv-payment', 'shipping-rate', 'ttv-shipping'
        ];
        charts.forEach(p => {
            if (document.getElementById(`${p}-chart-container`)) {
                setChartLoading(p);
            }
        });
    }

    async function fetchKpiData(endpoint, params = {}) {
        const url = new URL(endpoint, window.location.origin);
        Object.keys(params).forEach(k => {
            if (params[k]) url.searchParams.append(k, params[k]);
        });
        const res = await fetch(url);
        let data = {};
        try {
            data = await res.json();
        } catch (e) {
            throw new Error(`Erreur HTTP ${res.status}`);
        }
        if (!res.ok) {
            const msg = data.error || `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return data;
    }

    /**
     * Master refresh function fetching all KPIs (selectively based on active DOM elements)
     */
    async function refreshDashboard() {
        setAllSkeletons();
        const dateParams = { since: currentSince, until: currentUntil };

        // 1 & 2. MRR & ARR
        if (isNeeded('revenue', 'mrr-chart-container', 'arr-chart-container')) {
            fetchKpiData('/api/kpis/mrr/', dateParams)
                .then(data => {
                    currentPrevSince = data.prev_since || '';
                    currentPrevUntil = data.prev_until || '';

                    chartDataCache.mrr = {
                        title: 'MRR (Monthly Recurring Revenue)',
                        meaning: 'Revenu récurrent mensuel généré par les abonnements payants actifs sur la période.',
                        formula: "SUM(amount) WHERE status = 'paid' & type = 'subscription'",
                        source: 'billing_transactions',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.mrr,
                        prevTotal: data.previous_mrr,
                        valueKey: 'amount',
                        isCurrency: true,
                        label: 'MRR',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    chartDataCache.arr = {
                        title: 'ARR (Annual Recurring Revenue)',
                        meaning: 'Projection annualisée du revenu récurrent basée sur le MRR actuel (MRR × 12).',
                        formula: 'MRR × 12',
                        source: 'billing_transactions',
                        trend: data.arr_trend || [],
                        prevTrend: data.previous_arr_trend || [],
                        total: data.arr,
                        prevTotal: data.previous_arr,
                        valueKey: 'amount',
                        isCurrency: true,
                        label: 'ARR',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Top Hero Card 1 (Chiffre d'affaires réel sur la période)
                    const revVar = NealensCharts.formatVariation(data.revenue, data.previous_revenue);
                    const revVarColor = revVar.isNeutral ? 'text-[var(--text-faint)]' : (revVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    setKpiValue('revenue', formatCurrency(data.revenue), `<span class="${revVarColor}">${revVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);
                    const fullSeries = NealensCharts.generateDateRangeSeries(data.revenue_trend || data.trend, currentSince, currentUntil, 'amount', 0, data.granularity);
                    if (fullSeries && fullSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-revenue', fullSeries.map(t => parseFloat(t.amount) || 0));
                    }

                    // Chart 1: MRR
                    const mrrHeadline = document.getElementById('mrr-chart-headline');
                    if (mrrHeadline) mrrHeadline.textContent = formatCurrency(data.mrr);
                    updateVariationBadge('mrr-chart-variation', data.mrr, data.previous_mrr);
                    setChartLoaded('mrr');
                    NealensCharts.renderLineChart('mrr-chart-container', data.trend, 'amount', {
                        isCurrency: true,
                        label: 'MRR',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });

                    // Chart 2: ARR
                    const arrHeadline = document.getElementById('arr-chart-headline');
                    if (arrHeadline) arrHeadline.textContent = formatCurrency(data.arr);
                    updateVariationBadge('arr-chart-variation', data.arr, data.previous_arr);
                    setChartLoaded('arr');
                    NealensCharts.renderLineChart('arr-chart-container', data.arr_trend, 'amount', {
                        isCurrency: true,
                        label: 'ARR',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_arr_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('MRR/ARR error:', err);
                    setKpiError('revenue', err.message);
                    setChartError('mrr', err.message);
                    setChartError('arr', err.message);
                });
        }

        // 3. Paying Stores
        if (isNeeded('paying-stores', 'paying-stores-chart-container')) {
            fetchKpiData('/api/kpis/paying-stores/', dateParams)
                .then(data => {
                    chartDataCache.payingStores = {
                        title: 'Boutiques Payantes',
                        meaning: 'Nombre distinct de boutiques ayant un abonnement payant actif au cours de la période.',
                        formula: "COUNT(DISTINCT store_id) WHERE status = 'active'",
                        source: 'billing_subscriptions',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Boutiques Payantes',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Top Hero Card 3 (Boutiques Payantes)
                    const psVar = NealensCharts.formatVariation(data.total, data.previous_total);
                    const psVarColor = psVar.isNeutral ? 'text-[var(--text-faint)]' : (psVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    setKpiValue('paying-stores', formatNumber(data.total), `<span class="${psVarColor}">${psVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);
                    const fullPsSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullPsSeries && fullPsSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-paying-stores', fullPsSeries.map(t => t.count || 0));
                    }

                    const headline = document.getElementById('paying-stores-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('paying-stores-variation', data.total, data.previous_total);

                    setChartLoaded('paying-stores');
                    NealensCharts.renderLineChart('paying-stores-chart-container', data.trend, 'count', {
                        label: 'Boutiques Payantes',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Paying Stores error:', err);
                    setKpiError('paying-stores', err.message);
                    setChartError('paying-stores', err.message);
                });
        }

        // 4. Paying Users
        if (isNeeded('paying-users', 'paying-users-chart-container')) {
            fetchKpiData('/api/kpis/paying-users/', dateParams)
                .then(data => {
                    chartDataCache.payingUsers = {
                        title: 'Marchands Payants',
                        meaning: 'Nombre d\'utilisateurs distincts propriétaires d\'au moins une boutique avec abonnement actif.',
                        formula: 'COUNT(DISTINCT shops.owner_id) via billing_subscriptions actives',
                        source: 'billing_subscriptions ⨝ shops',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Marchands Payants',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Top Hero Card (Marchands Payants)
                    const puVar = NealensCharts.formatVariation(data.total, data.previous_total);
                    const puVarColor = puVar.isNeutral ? 'text-[var(--text-faint)]' : (puVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    setKpiValue('paying-users', formatNumber(data.total), `<span class="${puVarColor}">${puVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);
                    const fullPuSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullPuSeries && fullPuSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-paying-users', fullPuSeries.map(t => t.count || 0));
                    }

                    const headline = document.getElementById('paying-users-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('paying-users-variation', data.total, data.previous_total);

                    setChartLoaded('paying-users');
                    NealensCharts.renderLineChart('paying-users-chart-container', data.trend, 'count', {
                        label: 'Marchands Payants',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Paying Users error:', err);
                    setKpiError('paying-users', err.message);
                    setChartError('paying-users', err.message);
                });
        }

        // 5. Sign-ups
        if (isNeeded('users', 'signups-chart-container')) {
            fetchKpiData('/api/kpis/signups/', dateParams)
                .then(data => {
                    chartDataCache.signups = {
                        title: 'Inscriptions',
                        meaning: 'Nombre total de nouveaux comptes utilisateurs créés sur la plateforme.',
                        formula: 'COUNT(*) GROUP BY joined_on__date',
                        source: 'users',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Inscriptions',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Top Hero Card 2 (Utilisateurs)
                    const signVar = NealensCharts.formatVariation(data.total, data.previous_total);
                    const signVarColor = signVar.isNeutral ? 'text-[var(--text-faint)]' : (signVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    setKpiValue('users', formatNumber(data.total), `<span class="${signVarColor}">${signVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);
                    const fullSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullSeries && fullSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-users', fullSeries.map(t => t.count || 0));
                    }

                    // Chart 5: Sign-ups
                    const headline = document.getElementById('signups-chart-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('signups-chart-variation', data.total, data.previous_total);

                    setChartLoaded('signups');
                    NealensCharts.renderLineChart('signups-chart-container', data.trend, 'count', {
                        label: 'Inscriptions',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Signups error:', err);
                    setKpiError('users', err.message);
                    setChartError('signups', err.message);
                });
        }

        // 6. Sessions
        if (isNeeded('sessions-chart-container')) {
            fetchKpiData('/api/kpis/sessions/', dateParams)
                .then(data => {
                    chartDataCache.sessions = {
                        title: 'Sessions (Visites Plateforme)',
                        meaning: 'Volume total de sessions de navigation ouvertes sur la plateforme.',
                        formula: 'COUNT(*) GROUP BY started_at__date',
                        source: 'user_sessions',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Sessions',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    const headline = document.getElementById('sessions-chart-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('sessions-chart-variation', data.total, data.previous_total);

                    setChartLoaded('sessions');
                    NealensCharts.renderLineChart('sessions-chart-container', data.trend, 'count', {
                        label: 'Sessions',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Sessions error:', err);
                    setChartError('sessions', err.message);
                });
        }

        // 7. Active Users (DAU)
        if (isNeeded('active-users-chart-container')) {
            fetchKpiData('/api/kpis/active-users/', dateParams)
                .then(data => {
                    chartDataCache.activeUsers = {
                        title: 'Utilisateurs Actifs (DAU)',
                        meaning: 'Utilisateurs ayant effectué au moins une action métier significative (création produit, commande, etc.).',
                        formula: "COUNT(DISTINCT user_id) WHERE actor = 'user' AND event_type NOT IN ('login', 'logout', 'signup', 'page_view', 'switch_store')",
                        source: 'user_session_events',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Utilisateurs Actifs',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    const headline = document.getElementById('active-users-chart-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('active-users-chart-variation', data.total, data.previous_total);

                    setChartLoaded('active-users');
                    NealensCharts.renderLineChart('active-users-chart-container', data.trend, 'count', {
                        label: 'Utilisateurs Actifs',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Active Users error:', err);
                    setChartError('active-users', err.message);
                });
        }

        // 8. Active Stores
        if (isNeeded('active-stores-chart-container')) {
            fetchKpiData('/api/kpis/active-stores/', dateParams)
                .then(data => {
                    chartDataCache.activeStores = {
                        title: 'Boutiques Actives',
                        meaning: 'Boutiques enregistrant des actions métier réelles (abonnements payants, essais et gratuités inclus).',
                        formula: "COUNT(DISTINCT store_id) WHERE actor = 'user' AND event_type NOT IN ('login', 'logout', 'signup', 'page_view', 'switch_store')",
                        source: 'user_session_events',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.total,
                        prevTotal: data.previous_total,
                        valueKey: 'count',
                        label: 'Boutiques Actives',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    const headline = document.getElementById('active-stores-chart-headline');
                    if (headline) headline.textContent = formatNumber(data.total);
                    updateVariationBadge('active-stores-chart-variation', data.total, data.previous_total);

                    setChartLoaded('active-stores');
                    NealensCharts.renderLineChart('active-stores-chart-container', data.trend, 'count', {
                        label: 'Boutiques Actives',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Active Stores error:', err);
                    setChartError('active-stores', err.message);
                });
        }

        // 9. Activation (%)
        if (isNeeded('activation-chart-container')) {
            fetchKpiData('/api/kpis/activation/', dateParams)
                .then(data => {
                    chartDataCache.activation = {
                        title: 'Activation (Taux de Complétion Onboarding)',
                        meaning: 'Pourcentage de boutiques créées ayant finalisé le parcours d\'onboarding initial.',
                        formula: '(Boutiques onboarding terminé / Total boutiques créées) × 100',
                        source: 'shops (completed_onboarding_at)',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.rate,
                        prevTotal: data.previous_rate,
                        valueKey: 'rate',
                        isPercent: true,
                        label: 'Activation',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    const headline = document.getElementById('activation-chart-headline');
                    if (headline) headline.textContent = `${data.rate}%`;
                    updateVariationBadge('activation-chart-variation', data.rate, data.previous_rate);

                    setChartLoaded('activation');
                    NealensCharts.renderLineChart('activation-chart-container', data.trend, 'rate', {
                        isPercent: true,
                        label: 'Activation',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Activation error:', err);
                    setChartError('activation', err.message);
                });
        }

        // 10. Churn (Taux & Résiliations)
        if (isNeeded('churn', 'churn-chart-container')) {
            fetchKpiData('/api/kpis/churn/', dateParams)
                .then(data => {
                    chartDataCache.churn = {
                        title: 'Churn (Taux & Abonnements Résiliés)',
                        meaning: 'Pourcentage d\'abonnements résiliés par rapport au total des abonnements gérés.',
                        formula: '[Résiliations / (Actifs + Résiliations)] × 100',
                        source: 'billing_subscriptions',
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        total: data.churn_rate,
                        prevTotal: data.previous_churn_rate,
                        valueKey: 'count',
                        label: 'Résiliations',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Top Hero Card 4 (Churn)
                    const churnVar = NealensCharts.formatVariation(data.churn_rate, data.previous_churn_rate);
                    const churnVarColor = churnVar.isNeutral ? 'text-[var(--text-faint)]' : (churnVar.isPositive ? 'text-rose-400' : 'text-emerald-400');
                    setKpiValue('churn', `${data.churn_rate}%`, `<span class="text-[var(--text-faint)]">${data.canceled_count} résiliation(s) • </span><span class="${churnVarColor}">${churnVar.text}</span>`);
                    const fullChurnSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullChurnSeries && fullChurnSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-churn', fullChurnSeries.map(t => t.count || 0));
                    }

                    // Chart 10: Churn
                    const churnRateEl = document.getElementById('churn-rate-headline');
                    const churnCountEl = document.getElementById('churn-count-headline');
                    if (churnRateEl) churnRateEl.textContent = `${data.churn_rate}%`;
                    if (churnCountEl) churnCountEl.textContent = `(${data.canceled_count} résiliés)`;
                    updateVariationBadge('churn-chart-variation', data.churn_rate, data.previous_churn_rate);

                    setChartLoaded('churn');
                    NealensCharts.renderLineChart('churn-chart-container', data.trend, 'count', {
                        label: 'Résiliations',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Churn error:', err);
                    setKpiError('churn', err.message);
                    setChartError('churn', err.message);
                });
        }

        // 11. Rétention par Cohortes (Boutiques)
        if (isNeeded('retention-chart-container')) {
            fetchKpiData('/api/kpis/retention/')
                .then(data => {
                    chartDataCache.retention = {
                        title: 'Rétention par Cohortes (Boutiques)',
                        meaning: 'Taux de survie des boutiques regroupées par mois de 1ère souscription payante réelle (M0).',
                        formula: '(Boutiques actives au mois M_k / Taille initiale cohorte N_0) × 100',
                        source: 'billing_transactions (M0) + subscriptions',
                        isCohortHeatmap: true,
                        total: data.m1_retention_rate,
                        prevTotal: data.previous_m1_rate,
                        isPercent: true,
                        cohortData: data,
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil
                    };

                    const retHeadline = document.getElementById('retention-chart-headline');
                    if (retHeadline) retHeadline.textContent = `${data.m1_retention_rate}%`;
                    updateVariationBadge('retention-chart-variation', data.m1_retention_rate, data.previous_m1_rate);

                    const sampleBadge = document.getElementById('retention-sample-badge');
                    if (sampleBadge) {
                        if (data.is_preliminary) {
                            sampleBadge.classList.remove('hidden');
                            sampleBadge.textContent = `Échantillon préliminaire (${data.total_paid_stores} boutique${data.total_paid_stores > 1 ? 's' : ''})`;
                        } else {
                            sampleBadge.classList.add('hidden');
                        }
                    }

                    setChartLoaded('retention');
                    renderCohortHeatmap('retention-chart-container', data);
                })
                .catch(err => {
                    console.error('Retention error:', err);
                    setChartError('retention', err.message);
                });
        }

        // ==========================================
        // NEW HERO KPIS & CHARTS
        // ==========================================

        // 12. Feedbacks (Hero Card)
        if (isNeeded('feedback')) {
            fetchKpiData('/api/kpis/feedbacks/', dateParams)
                .then(data => {
                    chartDataCache.feedback = {
                        title: 'Feedbacks Reçus',
                        meaning: 'Total de tous les retours d\'utilisateurs reçus au cours de la période.',
                        formula: 'COUNT(*) FROM feedbacks',
                        source: 'feedbacks',
                        total: data.total,
                        prevTotal: data.previous_total,
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || []
                    };

                    const fbVar = NealensCharts.formatVariation(data.total, data.previous_total);
                    const fbVarColor = fbVar.isNeutral ? 'text-[var(--text-faint)]' : (fbVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    // Explicit requirement: no status subtext (En attente / Résolu), only period comparison
                    setKpiValue('feedback', formatNumber(data.total), `<span class="${fbVarColor}">${fbVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);

                    const fullFbSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullFbSeries && fullFbSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-feedback', fullFbSeries.map(t => t.count || 0));
                    }
                })
                .catch(err => {
                    console.error('Feedbacks error:', err);
                    setKpiError('feedback', err.message);
                });
        }

        // 13. Time Spent on Platform (Hero Card)
        if (isNeeded('time-spent')) {
            fetchKpiData('/api/kpis/time-spent/', dateParams)
                .then(data => {
                    chartDataCache.timeSpent = {
                        title: 'Temps Moyen par Session',
                        meaning: 'Durée moyenne d\'engagement actif des utilisateurs par session sur la plateforme.',
                        formula: 'AVG(active_duration_seconds) FROM user_sessions',
                        source: 'user_sessions',
                        avgSeconds: data.avg_seconds,
                        formattedAvg: data.formatted_avg,
                        prevAvgSeconds: data.previous_avg_seconds,
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || []
                    };

                    const tsVar = NealensCharts.formatVariation(data.avg_seconds, data.previous_avg_seconds);
                    const tsVarColor = tsVar.isNeutral ? 'text-[var(--text-faint)]' : (tsVar.isPositive ? 'text-emerald-400' : 'text-rose-400');
                    setKpiValue('time-spent', data.formatted_avg, `<span class="${tsVarColor}">${tsVar.text}</span> <span class="text-[var(--text-faint)]">vs période préc.</span>`);

                    const fullTsSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'seconds', 0, data.granularity);
                    if (fullTsSeries && fullTsSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-time-spent', fullTsSeries.map(t => t.seconds || 0));
                    }
                })
                .catch(err => {
                    console.error('Time Spent error:', err);
                    setKpiError('time-spent', err.message);
                });
        }

        // 14. AI Credit Usage (Hero Card & Line Chart)
        if (isNeeded('ai-credits', 'ai-usage-chart-container')) {
            fetchKpiData('/api/kpis/ai-usage/', dateParams)
                .then(data => {
                    chartDataCache.aiUsage = {
                        title: 'Consommation de Crédits IA',
                        meaning: 'Volume de crédits et de tokens consommés par les fonctionnalités d\'intelligence artificielle.',
                        formula: 'SUM(credits_used) & SUM(total_tokens) FROM ai_credit_usages',
                        source: 'ai_credit_usages',
                        total: data.total_credits,
                        prevTotal: data.previous_total_credits,
                        totalTokens: data.total_tokens,
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        valueKey: 'credits',
                        label: 'Crédits IA',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Hero Card
                    const aiVar = NealensCharts.formatVariation(data.total_credits, data.previous_total_credits);
                    const aiVarColor = aiVar.isNeutral ? 'text-[var(--text-faint)]' : (aiVar.isPositive ? 'text-amber-400' : 'text-emerald-400');
                    setKpiValue('ai-credits', `${formatNumber(data.total_credits)} cr.`, `<span class="text-[var(--text-faint)]">${formatNumber(data.total_tokens)} tokens • </span><span class="${aiVarColor}">${aiVar.text}</span>`);

                    const fullAiSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'credits', 0, data.granularity);
                    if (fullAiSeries && fullAiSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-ai-credits', fullAiSeries.map(t => t.credits || 0));
                    }

                    // Dedicated Line Chart
                    const headline = document.getElementById('ai-usage-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total_credits)} crédits (${formatNumber(data.total_tokens)} tokens)`;
                    updateVariationBadge('ai-usage-chart-variation', data.total_credits, data.previous_total_credits);

                    setChartLoaded('ai-usage');
                    NealensCharts.renderLineChart('ai-usage-chart-container', data.trend, 'credits', {
                        label: 'Crédits IA',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('AI Usage error:', err);
                    setKpiError('ai-credits', err.message);
                    setChartError('ai-usage', err.message);
                });
        }

        // 15. Boutiques Créées (Hero Card & Line Chart)
        if (isNeeded('created-shops', 'created-shops-chart-container')) {
            fetchKpiData('/api/kpis/created-shops/', dateParams)
                .then(data => {
                    chartDataCache.createdShops = {
                        title: 'Boutiques Créées',
                        meaning: 'Nombre de nouvelles boutiques créées sur la plateforme sur la période.',
                        formula: 'COUNT(*) FROM shops GROUP BY created_on__date',
                        source: 'shops',
                        total: data.total,
                        prevTotal: data.previous_total,
                        trend: data.trend || [],
                        prevTrend: data.previous_trend || [],
                        valueKey: 'count',
                        label: 'Boutiques créées',
                        since: data.since || currentSince,
                        until: data.until || currentUntil,
                        prevSince: data.prev_since || currentPrevSince,
                        prevUntil: data.prev_until || currentPrevUntil,
                        granularity: data.granularity || 'day'
                    };

                    // Hero Card
                    const shopVar = NealensCharts.formatVariation(data.total, data.previous_total);
                    const shopVarColor = shopVar.isNeutral ? 'text-[var(--text-faint)]' : (shopVar.isPositive ? 'text-emerald-400' : 'text-red-400');
                    setKpiValue('created-shops', `${formatNumber(data.total)}`, `<span class="${shopVarColor}">${shopVar.text}</span>`);

                    // Sparkline on KPI card
                    const fullShopSeries = NealensCharts.generateDateRangeSeries(data.trend, currentSince, currentUntil, 'count', 0, data.granularity);
                    if (fullShopSeries && fullShopSeries.length > 0) {
                        NealensCharts.renderSparkline('sparkline-created-shops', fullShopSeries.map(t => t.count || 0));
                    }

                    // Dedicated Line Chart
                    const headline = document.getElementById('created-shops-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total)} boutiques créées`;
                    updateVariationBadge('created-shops-chart-variation', data.total, data.previous_total);

                    setChartLoaded('created-shops');
                    NealensCharts.renderLineChart('created-shops-chart-container', data.trend, 'count', {
                        label: 'Boutiques créées',
                        since: currentSince,
                        until: currentUntil,
                        prevSince: currentPrevSince,
                        prevUntil: currentPrevUntil,
                        prevTrend: data.previous_trend,
                        granularity: data.granularity
                    });
                })
                .catch(err => {
                    console.error('Created Shops error:', err);
                    setKpiError('created-shops', err.message);
                    setChartError('created-shops', err.message);
                });
        }

        // 16. AI Categories (Donut Chart)
        if (isNeeded('ai-categories-chart-container')) {
            fetchKpiData('/api/kpis/ai-categories/', dateParams)
                .then(data => {
                    chartDataCache.aiCategories = {
                        title: 'Usages IA par Catégorie',
                        meaning: 'Répartition thématique des requêtes IA déclenchées par les marchands.',
                        formula: 'COUNT(*) GROUP BY category FROM ai_request_categories',
                        source: 'ai_request_categories',
                        isDonut: true,
                        total: data.total,
                        prevTotal: data.previous_total,
                        categories: data.categories || []
                    };

                    const headline = document.getElementById('ai-categories-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total)} requêtes générées`;
                    updateVariationBadge('ai-categories-chart-variation', data.total, data.previous_total);

                    setChartLoaded('ai-categories');
                    NealensCharts.renderDonutChart('ai-categories-chart-container', data.categories, { centerLabel: 'REQUÊTES' });
                })
                .catch(err => {
                    console.error('AI Categories error:', err);
                    setChartError('ai-categories', err.message);
                });
        }

        // 16. Top Pages (Ranked Horizontal Bars)
        if (isNeeded('top-pages-chart-container')) {
            fetchKpiData('/api/kpis/top-pages/', dateParams)
                .then(data => {
                    chartDataCache.topPages = {
                        title: 'Pages les Plus Visitées',
                        meaning: 'Classement des sections du dashboard les plus consultées par les utilisateurs.',
                        formula: "COUNT(*) WHERE page_type IS NOT NULL GROUP BY page_type ORDER BY views DESC",
                        source: 'user_session_events',
                        isRankedList: true,
                        total: data.total_views,
                        prevTotal: data.previous_total_views,
                        pages: data.pages || []
                    };

                    const headline = document.getElementById('top-pages-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total_views)} pages vues totales`;
                    updateVariationBadge('top-pages-chart-variation', data.total_views, data.previous_total_views);

                    setChartLoaded('top-pages');
                    NealensCharts.renderHorizontalBarChart('top-pages-chart-container', data.pages, { unitLabel: 'vues' });
                })
                .catch(err => {
                    console.error('Top Pages error:', err);
                    setChartError('top-pages', err.message);
                });
        }

        // 17. Business Models (Donut Chart)
        if (isNeeded('business-models-chart-container')) {
            fetchKpiData('/api/kpis/business-models/', dateParams)
                .then(data => {
                    chartDataCache.businessModels = {
                        title: 'Modèles Économiques des Boutiques',
                        meaning: 'Répartition des types d\'activités e-commerce configurés par les marchands.',
                        formula: 'COUNT(*) GROUP BY business_model FROM shops',
                        source: 'shops',
                        isDonut: true,
                        total: data.total,
                        models: data.models || []
                    };

                    const headline = document.getElementById('business-models-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total)} boutiques créées`;

                    setChartLoaded('business-models');
                    NealensCharts.renderDonutChart('business-models-chart-container', data.models, { centerLabel: 'BOUTIQUES' });
                })
                .catch(err => {
                    console.error('Business Models error:', err);
                    setChartError('business-models', err.message);
                });
        }

        // 18. Devices (Donut Chart)
        if (isNeeded('devices-chart-container')) {
            fetchKpiData('/api/kpis/devices/', dateParams)
                .then(data => {
                    chartDataCache.devices = {
                        title: 'Répartition des Appareils',
                        meaning: 'Types de terminaux utilisés pour accéder au dashboard Nealens.',
                        formula: 'COUNT(*) GROUP BY device_type FROM user_sessions',
                        source: 'user_sessions',
                        isDonut: true,
                        total: data.total,
                        prevTotal: data.previous_total,
                        devices: data.devices || []
                    };

                    const headline = document.getElementById('devices-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total)} sessions enregistrées`;
                    updateVariationBadge('devices-chart-variation', data.total, data.previous_total);

                    setChartLoaded('devices');
                    NealensCharts.renderDonutChart('devices-chart-container', data.devices, { centerLabel: 'SESSIONS' });
                })
                .catch(err => {
                    console.error('Devices error:', err);
                    setChartError('devices', err.message);
                });
        }

        // 19. Geo Distribution: Paid vs Non-Paying (Grouped Horizontal Bars)
        if (isNeeded('geo-distribution-chart-container')) {
            fetchKpiData('/api/kpis/geo-distribution/', dateParams)
                .then(data => {
                    chartDataCache.geoDistribution = {
                        title: 'Répartition Géographique (Payants vs Gratuits)',
                        meaning: 'Comparaison du volume de boutiques payantes et gratuites par pays d\'origine.',
                        formula: 'COUNT(*) GROUP BY country__code & abonnement actif',
                        source: 'shops ⨝ billing_subscriptions',
                        isGroupedBar: true,
                        totalStores: data.total_stores,
                        totalPaidStores: data.total_paid_stores,
                        countries: data.countries || []
                    };

                    const headline = document.getElementById('geo-distribution-chart-headline');
                    if (headline) headline.textContent = `${formatNumber(data.total_paid_stores)} payantes sur ${formatNumber(data.total_stores)} boutiques`;

                    setChartLoaded('geo-distribution');
                    NealensCharts.renderGroupedBarChart('geo-distribution-chart-container', data.countries);
                })
                .catch(err => {
                    console.error('Geo Distribution error:', err);
                    setChartError('geo-distribution', err.message);
                });
        }

        // 20. Time-to-Value Metrics (5 Histograms: Product, Storefront, Publish, Payment, Shipping)
        if (isNeeded('ttv-product-chart-container', 'ttv-storefront-chart-container', 'ttv-publish-chart-container', 'ttv-payment-chart-container', 'ttv-shipping-chart-container')) {
            fetchKpiData('/api/kpis/time-to-value/', dateParams)
                .then(data => {
                    const ttvConfig = [
                        { key: 'product', chartPrefix: 'ttv-product', cacheKey: 'ttvProduct', unitSuffix: 'boutiques' },
                        { key: 'storefront', chartPrefix: 'ttv-storefront', cacheKey: 'ttvStorefront', unitSuffix: 'vitrines créées' },
                        { key: 'publish', chartPrefix: 'ttv-publish', cacheKey: 'ttvPublish', unitSuffix: 'publications' },
                        { key: 'payment', chartPrefix: 'ttv-payment', cacheKey: 'ttvPayment', unitSuffix: 'moyens ajoutés' },
                        { key: 'shipping', chartPrefix: 'ttv-shipping', cacheKey: 'ttvShipping', unitSuffix: 'zones configurées' }
                    ];

                    ttvConfig.forEach(cfg => {
                        const item = data[cfg.key];
                        if (!item) return;

                        chartDataCache[cfg.cacheKey] = {
                            title: item.title,
                            meaning: item.meaning,
                            formula: 'AVG(first_target_event_time - create_store_event_time)',
                            source: 'user_session_events (create_store -> target event)',
                            isHistogram: true,
                            avgHours: item.avg_hours,
                            formattedAvg: item.formatted_avg,
                            totalCompleted: item.total_completed,
                            buckets: item.buckets || []
                        };

                        const headline = document.getElementById(`${cfg.chartPrefix}-chart-headline`);
                        if (headline) headline.textContent = `Temps moyen : ${item.formatted_avg} (${formatNumber(item.total_completed)} ${cfg.unitSuffix})`;

                        setChartLoaded(cfg.chartPrefix);
                        NealensCharts.renderHistogramChart(`${cfg.chartPrefix}-chart-container`, item.buckets);
                    });
                })
                .catch(err => {
                    console.error('Time to Value error:', err);
                    ['ttv-product', 'ttv-storefront', 'ttv-publish', 'ttv-payment', 'ttv-shipping'].forEach(p => setChartError(p, err.message));
                });
        }

        // 21. Onboarding Adoption Rates (3 % Curves: Publish, Payment, Shipping)
        if (isNeeded('publish-rate-chart-container', 'payment-rate-chart-container', 'shipping-rate-chart-container')) {
            fetchKpiData('/api/kpis/onboarding-rates/', dateParams)
                .then(data => {
                    const rateConfigs = [
                        { key: 'publish', chartPrefix: 'publish-rate', cacheKey: 'publishRate', label: 'Taux de Publication', meaning: 'Pourcentage de boutiques créées ayant publié leur vitrine en ligne.' },
                        { key: 'payment', chartPrefix: 'payment-rate', cacheKey: 'paymentRate', label: 'Taux Moyen de Paiement', meaning: 'Pourcentage de boutiques ayant activé au moins un moyen de paiement.' },
                        { key: 'shipping', chartPrefix: 'shipping-rate', cacheKey: 'shippingRate', label: 'Taux Zone de Livraison', meaning: 'Pourcentage de boutiques ayant configuré au moins une zone d\'expédition.' }
                    ];

                    rateConfigs.forEach(cfg => {
                        const item = data[cfg.key];
                        if (!item) return;

                        chartDataCache[cfg.cacheKey] = {
                            title: cfg.label,
                            meaning: cfg.meaning,
                            formula: '(Boutiques configurées / Total boutiques) × 100',
                            source: 'user_session_events ⨝ shops',
                            trend: item.trend || [],
                            prevTrend: item.previous_trend || [],
                            total: item.rate,
                            prevTotal: item.previous_rate,
                            valueKey: 'rate',
                            isPercent: true,
                            label: cfg.label,
                            since: data.since || currentSince,
                            until: data.until || currentUntil,
                            prevSince: data.prev_since || currentPrevSince,
                            prevUntil: data.prev_until || currentPrevUntil,
                            granularity: data.granularity || 'day'
                        };

                        const headline = document.getElementById(`${cfg.chartPrefix}-chart-headline`);
                        if (headline) headline.textContent = `${item.rate}% (${formatNumber(item.stores_count)} boutiques)`;
                        updateVariationBadge(`${cfg.chartPrefix}-chart-variation`, item.rate, item.previous_rate);

                        setChartLoaded(cfg.chartPrefix);
                        NealensCharts.renderLineChart(`${cfg.chartPrefix}-chart-container`, item.trend, 'rate', {
                            isPercent: true,
                            label: cfg.label,
                            since: currentSince,
                            until: currentUntil,
                            prevSince: currentPrevSince,
                            prevUntil: currentPrevUntil,
                            prevTrend: item.previous_trend,
                            granularity: data.granularity
                        });
                    });
                })
                .catch(err => {
                    console.error('Onboarding Rates error:', err);
                    ['publish-rate', 'payment-rate', 'shipping-rate'].forEach(p => setChartError(p, err.message));
                });
        }

        }
    }

    function redrawAllCharts() {
        const opts = { since: currentSince, until: currentUntil, prevSince: currentPrevSince, prevUntil: currentPrevUntil };
        
        // Standard Line Charts
        if (chartDataCache.mrr) NealensCharts.renderLineChart('mrr-chart-container', chartDataCache.mrr.trend, 'amount', { isCurrency: true, label: 'MRR', prevTrend: chartDataCache.mrr.prevTrend, granularity: chartDataCache.mrr.granularity, ...opts });
        if (chartDataCache.arr) NealensCharts.renderLineChart('arr-chart-container', chartDataCache.arr.trend, 'amount', { isCurrency: true, label: 'ARR', prevTrend: chartDataCache.arr.prevTrend, granularity: chartDataCache.arr.granularity, ...opts });
        if (chartDataCache.payingStores) NealensCharts.renderLineChart('paying-stores-chart-container', chartDataCache.payingStores.trend, 'count', { label: 'Boutiques Payantes', prevTrend: chartDataCache.payingStores.prevTrend, granularity: chartDataCache.payingStores.granularity, ...opts });
        if (chartDataCache.payingUsers) NealensCharts.renderLineChart('paying-users-chart-container', chartDataCache.payingUsers.trend, 'count', { label: 'Marchands Payants', prevTrend: chartDataCache.payingUsers.prevTrend, granularity: chartDataCache.payingUsers.granularity, ...opts });
        if (chartDataCache.signups) NealensCharts.renderLineChart('signups-chart-container', chartDataCache.signups.trend, 'count', { label: 'Inscriptions', prevTrend: chartDataCache.signups.prevTrend, granularity: chartDataCache.signups.granularity, ...opts });
        if (chartDataCache.sessions) NealensCharts.renderLineChart('sessions-chart-container', chartDataCache.sessions.trend, 'count', { label: 'Sessions', prevTrend: chartDataCache.sessions.prevTrend, granularity: chartDataCache.sessions.granularity, ...opts });
        if (chartDataCache.activeUsers) NealensCharts.renderLineChart('active-users-chart-container', chartDataCache.activeUsers.trend, 'count', { label: 'Utilisateurs Actifs', prevTrend: chartDataCache.activeUsers.prevTrend, granularity: chartDataCache.activeUsers.granularity, ...opts });
        if (chartDataCache.activeStores) NealensCharts.renderLineChart('active-stores-chart-container', chartDataCache.activeStores.trend, 'count', { label: 'Boutiques Actives', prevTrend: chartDataCache.activeStores.prevTrend, granularity: chartDataCache.activeStores.granularity, ...opts });
        if (chartDataCache.activation) NealensCharts.renderLineChart('activation-chart-container', chartDataCache.activation.trend, 'rate', { isPercent: true, label: 'Activation', prevTrend: chartDataCache.activation.prevTrend, granularity: chartDataCache.activation.granularity, ...opts });
        if (chartDataCache.churn) NealensCharts.renderLineChart('churn-chart-container', chartDataCache.churn.trend, 'count', { label: 'Résiliations', prevTrend: chartDataCache.churn.prevTrend, granularity: chartDataCache.churn.granularity, ...opts });
        if (chartDataCache.retention) renderCohortHeatmap('retention-chart-container', chartDataCache.retention.cohortData);

        // New Line Charts
        if (chartDataCache.aiUsage) NealensCharts.renderLineChart('ai-usage-chart-container', chartDataCache.aiUsage.trend, 'credits', { label: 'Crédits IA', prevTrend: chartDataCache.aiUsage.prevTrend, granularity: chartDataCache.aiUsage.granularity, ...opts });
        if (chartDataCache.publishRate) NealensCharts.renderLineChart('publish-rate-chart-container', chartDataCache.publishRate.trend, 'rate', { isPercent: true, label: 'Taux Publication', prevTrend: chartDataCache.publishRate.prevTrend, granularity: chartDataCache.publishRate.granularity, ...opts });
        if (chartDataCache.paymentRate) NealensCharts.renderLineChart('payment-rate-chart-container', chartDataCache.paymentRate.trend, 'rate', { isPercent: true, label: 'Taux Paiement', prevTrend: chartDataCache.paymentRate.prevTrend, granularity: chartDataCache.paymentRate.granularity, ...opts });
        if (chartDataCache.shippingRate) NealensCharts.renderLineChart('shipping-rate-chart-container', chartDataCache.shippingRate.trend, 'rate', { isPercent: true, label: 'Taux Livraison', prevTrend: chartDataCache.shippingRate.prevTrend, granularity: chartDataCache.shippingRate.granularity, ...opts });

        // Donut Charts
        if (chartDataCache.aiCategories) NealensCharts.renderDonutChart('ai-categories-chart-container', chartDataCache.aiCategories.categories, { centerLabel: 'REQUÊTES' });
        if (chartDataCache.businessModels) NealensCharts.renderDonutChart('business-models-chart-container', chartDataCache.businessModels.models, { centerLabel: 'BOUTIQUES' });
        if (chartDataCache.devices) NealensCharts.renderDonutChart('devices-chart-container', chartDataCache.devices.devices, { centerLabel: 'SESSIONS' });

        // Horizontal Bar Chart
        if (chartDataCache.topPages) NealensCharts.renderHorizontalBarChart('top-pages-chart-container', chartDataCache.topPages.pages, { unitLabel: 'vues' });

        // Grouped Bar Chart
        if (chartDataCache.geoDistribution) NealensCharts.renderGroupedBarChart('geo-distribution-chart-container', chartDataCache.geoDistribution.countries);

        // Histograms
        if (chartDataCache.ttvProduct) NealensCharts.renderHistogramChart('ttv-product-chart-container', chartDataCache.ttvProduct.buckets);
        if (chartDataCache.ttvStorefront) NealensCharts.renderHistogramChart('ttv-storefront-chart-container', chartDataCache.ttvStorefront.buckets);
        if (chartDataCache.ttvPublish) NealensCharts.renderHistogramChart('ttv-publish-chart-container', chartDataCache.ttvPublish.buckets);
        if (chartDataCache.ttvPayment) NealensCharts.renderHistogramChart('ttv-payment-chart-container', chartDataCache.ttvPayment.buckets);
        if (chartDataCache.ttvShipping) NealensCharts.renderHistogramChart('ttv-shipping-chart-container', chartDataCache.ttvShipping.buckets);
    }

    // Export KPI Data to Structured JSON with detailed Axes, Labels, and Metrics metadata
    function exportKpiDataJson(kpiKey) {
        const keyMap = {
            'paying-stores': 'payingStores',
            'paying-users': 'payingUsers',
            'active-users': 'activeUsers',
            'active-stores': 'activeStores',
            'ai-usage': 'aiUsage',
            'ai-categories': 'aiCategories',
            'top-pages': 'topPages',
            'business-models': 'businessModels',
            'geo-distribution': 'geoDistribution',
            'ttv-product': 'ttvProduct',
            'ttv-storefront': 'ttvStorefront',
            'ttv-publish': 'ttvPublish',
            'ttv-payment': 'ttvPayment',
            'ttv-shipping': 'ttvShipping',
            'publish-rate': 'publishRate',
            'payment-rate': 'paymentRate',
            'shipping-rate': 'shippingRate'
        };
        const cacheKey = keyMap[kpiKey] || kpiKey;
        const item = chartDataCache[cacheKey];
        if (!item) {
            console.warn(`Export impossible: aucune donnée disponible pour ${kpiKey}`);
            return;
        }

        let exportPayload;

        if (item.isCohortHeatmap) {
            const cohortsList = (item.cohortData && item.cohortData.cohorts) ? item.cohortData.cohorts : [];
            const maxOffsets = cohortsList.reduce((max, c) => Math.max(max, (c.rates || []).length), 0);
            const offsetColumns = Array.from({ length: maxOffsets || 12 }, (_, i) => ({
                offset: `M${i}`,
                label: i === 0 ? "Mois 0 (M0 - Souscription payante initiale)" : `Mois ${i} (M${i} - ${i} mois après 1er paiement)`,
                description: i === 0 ? "100% de la cohorte initiale (dénominateur fixe N_0)" : `Taux de survie au ${i}ème mois après le premier abonnement payant`
            }));

            exportPayload = {
                metadata: {
                    kpi: 'retention',
                    title: item.title || 'Rétention par Cohortes (Boutiques)',
                    meaning: item.meaning || 'Taux de survie des boutiques regroupées par mois de 1ère souscription payante réelle (M0).',
                    calculation_method: item.formula || '(Boutiques payantes au mois M_k / Taille initiale cohorte N_0) × 100',
                    data_source: item.source || 'billing_transactions (M0 payé) + billing_subscriptions',
                    export_timestamp: new Date().toISOString()
                },
                axes: {
                    x_axis: {
                        name: "Axe horizontal (Mois d'ancienneté relatif / Offsets)",
                        field: "month_offset",
                        type: "discrete_timeline_offset",
                        label: "Mois d'ancienneté relatif (M0, M1, M2...)",
                        description: "M0 = mois du 1er abonnement payant, M1 = 1 mois après, etc.",
                        columns: offsetColumns
                    },
                    y_axis: {
                        name: "Axe vertical (Cohortes mensuelles)",
                        field: "cohort",
                        type: "monthly_cohort_date",
                        format: "YYYY-MM",
                        label: "Mois de cohorte (1ère souscription payante)",
                        description: "Chaque ligne correspond aux boutiques ayant souscrit leur premier abonnement payant durant ce mois calendaire.",
                        cohorts_count: cohortsList.length
                    },
                    cell_values: {
                        name: "Valeurs de la matrice (Taux de rétention et effectifs)",
                        type: "percentage_and_count",
                        unit: "Pourcentage (%) & Nombre de boutiques",
                        label: "Taux de survie (%) / Effectif actif",
                        description: "Pourcentage calculé sur la taille initiale fixe de la cohorte"
                    }
                },
                period: {
                    since: item.since || currentSince,
                    until: item.until || currentUntil,
                    previous_since: item.prevSince || currentPrevSince,
                    previous_until: item.prevUntil || currentPrevUntil
                },
                summary: {
                    m1_average_retention_rate_percent: item.total,
                    formatted_m1_average_rate: `${item.total}%`,
                    previous_m1_rate_percent: item.prevTotal,
                    formatted_previous_m1_rate: `${item.prevTotal}%`,
                    total_paid_stores_in_cohorts: item.cohortData ? item.cohortData.total_paid_stores : 0,
                    is_preliminary_sample: item.cohortData ? item.cohortData.is_preliminary : false
                },
                cohorts: cohortsList.map(c => ({
                    cohort: c.cohort,
                    cohort_label: c.cohort_label || c.cohort,
                    initial_paid_stores_count: c.initial_count,
                    is_small_sample: !!c.is_small_sample,
                    retention_timeline: (c.rates || []).map((rate, mIdx) => ({
                        month_offset: `M${mIdx}`,
                        month_label: mIdx === 0 ? "Mois 0 (Acquisition)" : `Mois ${mIdx}`,
                        retained_stores_count: c.counts ? c.counts[mIdx] : Math.round((rate / 100) * c.initial_count),
                        survival_rate_percent: rate,
                        formatted_rate: `${rate}%`
                    }))
                }))
            };
        } else if (item.isDonut) {
            exportPayload = {
                metadata: {
                    kpi: kpiKey,
                    title: item.title || kpiKey.toUpperCase(),
                    meaning: item.meaning || '',
                    calculation_method: item.formula || '',
                    data_source: item.source || '',
                    export_timestamp: new Date().toISOString()
                },
                summary: {
                    total_count: item.total,
                    previous_total_count: item.prevTotal
                },
                segments: item.categories || item.models || item.devices || item.methods || []
            };
        } else if (item.isRankedList) {
            exportPayload = {
                metadata: {
                    kpi: kpiKey,
                    title: item.title || kpiKey.toUpperCase(),
                    meaning: item.meaning || '',
                    calculation_method: item.formula || '',
                    data_source: item.source || '',
                    export_timestamp: new Date().toISOString()
                },
                summary: {
                    total_views: item.total,
                    previous_total_views: item.prevTotal
                },
                rankings: item.pages || []
            };
        } else if (item.isHistogram) {
            exportPayload = {
                metadata: {
                    kpi: kpiKey,
                    title: item.title || kpiKey.toUpperCase(),
                    meaning: item.meaning || '',
                    calculation_method: item.formula || '',
                    data_source: item.source || '',
                    export_timestamp: new Date().toISOString()
                },
                summary: {
                    avg_hours: item.avgHours,
                    formatted_avg: item.formattedAvg,
                    total_completed: item.totalCompleted
                },
                buckets: item.buckets || []
            };
        } else if (item.isGroupedBar) {
            exportPayload = {
                metadata: {
                    kpi: kpiKey,
                    title: item.title || kpiKey.toUpperCase(),
                    meaning: item.meaning || '',
                    calculation_method: item.formula || '',
                    data_source: item.source || '',
                    export_timestamp: new Date().toISOString()
                },
                summary: {
                    total_stores: item.totalStores,
                    total_paid_stores: item.totalPaidStores
                },
                countries: item.countries || []
            };
        } else {
            const varObj = NealensCharts.formatVariation(item.total, item.prevTotal);
            const unitStr = item.isCurrency ? 'USD ($)' : (item.isPercent ? 'Pourcentage (%)' : 'Unité');
            const yType = item.isCurrency ? 'currency' : (item.isPercent ? 'percentage' : 'integer');
            const isMonthly = item.granularity === 'month' || (item.trend && item.trend.length > 0 && item.trend[0].day && item.trend[0].day.length === 7);

            const currentTrendPoints = (item.trend || []).map(p => {
                const val = item.valueKey ? p[item.valueKey] : (p.amount ?? p.count ?? p.rate ?? p.credits ?? 0);
                return {
                    date: p.day,
                    formatted_date_fr: NealensCharts.formatDateLongFr ? NealensCharts.formatDateLongFr(p.day) : p.day,
                    value: val,
                    formatted_value: item.isCurrency ? NealensCharts.formatCurrency(val) : (item.isPercent ? `${val}%` : NealensCharts.formatNumber(val))
                };
            });

            const prevTrendPoints = (item.prevTrend || []).map(p => {
                const val = item.valueKey ? p[item.valueKey] : (p.amount ?? p.count ?? p.rate ?? p.credits ?? 0);
                return {
                    date: p.day,
                    formatted_date_fr: NealensCharts.formatDateLongFr ? NealensCharts.formatDateLongFr(p.day) : p.day,
                    value: val,
                    formatted_value: item.isCurrency ? NealensCharts.formatCurrency(val) : (item.isPercent ? `${val}%` : NealensCharts.formatNumber(val))
                };
            });

            const allValues = [...currentTrendPoints.map(p => p.value), ...prevTrendPoints.map(p => p.value)];
            const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
            const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;

            exportPayload = {
                metadata: {
                    kpi: kpiKey,
                    title: item.title || kpiKey.toUpperCase(),
                    meaning: item.meaning || '',
                    calculation_method: item.formula || '',
                    data_source: item.source || '',
                    export_timestamp: new Date().toISOString()
                },
                axes: {
                    x_axis: {
                        name: isMonthly ? "Axe horizontal (Mois / Chronologie)" : "Axe horizontal (Temps / Chronologie)",
                        field: "date",
                        type: "time_series",
                        granularity: isMonthly ? "monthly" : "daily",
                        format: isMonthly ? "YYYY-MM" : "YYYY-MM-DD",
                        label: isMonthly ? "Mois" : "Date",
                        time_range: {
                            current_since: item.since || currentSince,
                            current_until: item.until || currentUntil,
                            previous_since: item.prevSince || currentPrevSince,
                            previous_until: item.prevUntil || currentPrevUntil,
                            current_points_count: currentTrendPoints.length,
                            previous_points_count: prevTrendPoints.length
                        }
                    },
                    y_axis: {
                        name: `Axe vertical (${item.label || 'Valeur'})`,
                        field: "value",
                        type: yType,
                        unit: unitStr,
                        label: item.label || 'Valeur',
                        description: `Mesure ${isMonthly ? 'mensuelle' : 'quotidienne'} de ${item.label || item.title}`,
                        scale: "linear",
                        range: {
                            min_value: minValue,
                            max_value: maxValue
                        }
                    }
                },
                series: [
                    {
                        id: "current_period",
                        name: "Période en cours",
                        period: {
                            since: item.since || currentSince,
                            until: item.until || currentUntil
                        },
                        data_points_count: currentTrendPoints.length,
                        summary_value: item.total,
                        formatted_summary_value: item.isCurrency ? NealensCharts.formatCurrency(item.total) : (item.isPercent ? `${item.total}%` : NealensCharts.formatNumber(item.total))
                    },
                    {
                        id: "previous_period",
                        name: "Période précédente (comparaison)",
                        period: {
                            since: item.prevSince || currentPrevSince,
                            until: item.prevUntil || currentPrevUntil
                        },
                        data_points_count: prevTrendPoints.length,
                        summary_value: item.prevTotal,
                        formatted_summary_value: item.isCurrency ? NealensCharts.formatCurrency(item.prevTotal) : (item.isPercent ? `${item.prevTotal}%` : NealensCharts.formatNumber(item.prevTotal))
                    }
                ],
                summary: {
                    current_period_value: item.total,
                    formatted_current_value: item.isCurrency ? NealensCharts.formatCurrency(item.total) : (item.isPercent ? `${item.total}%` : NealensCharts.formatNumber(item.total)),
                    previous_period_value: item.prevTotal,
                    formatted_previous_value: item.isCurrency ? NealensCharts.formatCurrency(item.prevTotal) : (item.isPercent ? `${item.prevTotal}%` : NealensCharts.formatNumber(item.prevTotal)),
                    variation_percentage: varObj.text,
                    is_positive_growth: varObj.isPositive
                },
                data: {
                    current_period: currentTrendPoints,
                    previous_period: prevTrendPoints
                }
            };
        }

        const jsonString = JSON.stringify(exportPayload, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filenameSafeKpi = kpiKey.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        a.download = `nealens_${filenameSafeKpi}_${currentSince}_${currentUntil}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    function saveDateState(preset, since, until) {
        try {
            if (preset) localStorage.setItem('nealens_date_preset', preset);
            if (since) localStorage.setItem('nealens_date_since', since);
            if (until) localStorage.setItem('nealens_date_until', until);
        } catch (e) {}
    }

    function loadDateState() {
        try {
            const savedPreset = localStorage.getItem('nealens_date_preset');
            const savedSince = localStorage.getItem('nealens_date_since');
            const savedUntil = localStorage.getItem('nealens_date_until');

            if (savedPreset && savedPreset !== 'custom') {
                const dates = getPresetDates(savedPreset);
                return { preset: savedPreset, since: dates.since, until: dates.until };
            } else if (savedSince && savedUntil) {
                return { preset: 'custom', since: savedSince, until: savedUntil };
            }
        } catch (e) {}
        const defaultDates = getPresetDates('30d');
        return { preset: '30d', since: defaultDates.since, until: defaultDates.until };
    }

    function initEvents() {
        // Mobile Sidebar Drawer Toggle
        const sidebar = document.getElementById('sidebar');
        const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');

        function openSidebar() {
            if (sidebar) sidebar.classList.remove('-translate-x-full');
            if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
        }

        function closeSidebar() {
            if (sidebar) sidebar.classList.add('-translate-x-full');
            if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
        }

        if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', openSidebar);
        if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
        if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

        // Period Presets
        const periodBtns = document.querySelectorAll('.period-btn');
        periodBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                periodBtns.forEach(b => {
                    b.classList.remove('active-period', 'bg-[var(--bg-card-raised)]', 'text-[var(--text-main)]', 'font-semibold', 'shadow-sm');
                    b.classList.add('text-[var(--text-muted)]', 'font-medium');
                });
                this.classList.add('active-period', 'bg-[var(--bg-card-raised)]', 'text-[var(--text-main)]', 'font-semibold', 'shadow-sm');
                this.classList.remove('text-[var(--text-muted)]', 'font-medium');

                const preset = this.getAttribute('data-period');
                const dates = getPresetDates(preset);
                currentSince = dates.since;
                currentUntil = dates.until;

                const inputSince = document.getElementById('input-since');
                const inputUntil = document.getElementById('input-until');
                if (inputSince) inputSince.value = currentSince;
                if (inputUntil) inputUntil.value = currentUntil;

                saveDateState(preset, currentSince, currentUntil);
                refreshDashboard();
            });
        });

        // Apply Custom Dates
        const btnApply = document.getElementById('btn-apply-dates');
        if (btnApply) {
            btnApply.addEventListener('click', function() {
                const s = document.getElementById('input-since').value;
                const u = document.getElementById('input-until').value;
                if (s && u) {
                    periodBtns.forEach(b => {
                        b.classList.remove('active-period', 'bg-[var(--bg-card-raised)]', 'text-[var(--text-main)]', 'font-semibold', 'shadow-sm');
                        b.classList.add('text-[var(--text-muted)]', 'font-medium');
                    });
                    currentSince = s;
                    currentUntil = u;
                    saveDateState('custom', currentSince, currentUntil);
                    refreshDashboard();
                }
            });
        }

        // Export JSON Trigger Buttons
        document.addEventListener('click', function(e) {
            const exportBtn = e.target.closest('[data-export-kpi]');
            if (exportBtn) {
                const kpi = exportBtn.getAttribute('data-export-kpi');
                exportKpiDataJson(kpi);
            }
        });

        // Window Resize & Theme Change Handlers
        let resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(redrawAllCharts, 150);
        });

        window.addEventListener('themeChanged', function() {
            setTimeout(redrawAllCharts, 50);
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        const state = loadDateState();
        currentSince = state.since;
        currentUntil = state.until;

        const periodBtns = document.querySelectorAll('.period-btn');
        periodBtns.forEach(b => {
            if (b.getAttribute('data-period') === state.preset) {
                b.classList.add('active-period', 'bg-[var(--bg-card-raised)]', 'text-[var(--text-main)]', 'font-semibold', 'shadow-sm');
                b.classList.remove('text-[var(--text-muted)]', 'font-medium');
            } else {
                b.classList.remove('active-period', 'bg-[var(--bg-card-raised)]', 'text-[var(--text-main)]', 'font-semibold', 'shadow-sm');
                b.classList.add('text-[var(--text-muted)]', 'font-medium');
            }
        });

        const inputSince = document.getElementById('input-since');
        const inputUntil = document.getElementById('input-until');
        if (inputSince) inputSince.value = currentSince;
        if (inputUntil) inputUntil.value = currentUntil;

        initEvents();
        refreshDashboard();
    });
})();
