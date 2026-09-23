/**
 * Nealens SaaS Charting Engine (Pure Custom SVG)
 * Smooth bezier curves with gradient area fill for current period + dashed comparison curve for previous period.
 * Single unified color palette (#ff6b00) - Zero external dependencies.
 */

const NealensCharts = (function() {
    const MONTHS_SHORT_FR = [
        'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
        'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
    ];

    const MONTHS_FULL_FR = [
        'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
        'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
    ];

    function formatDateShortFr(dateStr) {
        if (!dateStr) return '';
        const parts = String(dateStr).split('-');
        if (parts.length === 2) {
            const monthIdx = parseInt(parts[1], 10) - 1;
            if (monthIdx >= 0 && monthIdx < 12) {
                return `${MONTHS_SHORT_FR[monthIdx]}`;
            }
            return dateStr;
        }
        if (parts.length < 3) return dateStr;
        const day = parseInt(parts[2], 10);
        const monthIdx = parseInt(parts[1], 10) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
            return `${day} ${MONTHS_SHORT_FR[monthIdx]}`;
        }
        return dateStr;
    }

    function formatDateLongFr(dateStr) {
        if (!dateStr) return '';
        const parts = String(dateStr).split('-');
        if (parts.length === 2) {
            const monthIdx = parseInt(parts[1], 10) - 1;
            const year = parts[0];
            if (monthIdx >= 0 && monthIdx < 12) {
                return `${MONTHS_FULL_FR[monthIdx]} ${year}`;
            }
            return dateStr;
        }
        if (parts.length < 3) return dateStr;
        const day = parseInt(parts[2], 10);
        const monthIdx = parseInt(parts[1], 10) - 1;
        const year = parts[0];
        if (monthIdx >= 0 && monthIdx < 12) {
            return `${day} ${MONTHS_FULL_FR[monthIdx]} ${year}`;
        }
        return dateStr;
    }

    function getThemeColor() {
        return getComputedStyle(document.documentElement).getPropertyValue('--primary-accent').trim() || '#ff6b00';
    }

    function getMutedTextColor() {
        return getComputedStyle(document.documentElement).getPropertyValue('--text-faint').trim() || '#595c6c';
    }

    function getGridColor() {
        return getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() || '#23252f';
    }

    function getPreviousCurveColor() {
        const isDark = document.documentElement.classList.contains('dark');
        return isDark ? '#595c6c' : '#9ca3af';
    }

    function getTooltipTheme() {
        const isDark = document.documentElement.classList.contains('dark');
        return {
            bg: isDark ? '#1a1b22' : '#ffffff',
            border: isDark ? '#2e303d' : '#e2e4e9',
            dateText: isDark ? '#f9fafb' : '#111827',
            divider: isDark ? '#2a2b37' : '#f1f3f7',
            label: isDark ? '#848796' : '#6b7280',
            prevLabel: isDark ? '#6b7082' : '#9ca3af',
            value: '#ff6b00',
            prevValue: isDark ? '#a1a5b8' : '#6b7280',
            shadow: isDark
                ? '0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 4px 6px -2px rgba(0, 0, 0, 0.4)'
                : '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
        };
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return Number(num).toLocaleString();
    }

    function formatCurrency(num) {
        if (num === null || num === undefined || isNaN(num)) return '$0';
        if (num >= 1000000) return '$' + (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'k';
        return '$' + Number(num).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function formatVariation(current, previous) {
        const curr = parseFloat(current) || 0;
        const prev = parseFloat(previous) || 0;
        if (prev === 0) {
            if (curr === 0) return { text: '0%', isPositive: true, isNeutral: true };
            return { text: '+100%', isPositive: true, isNeutral: false };
        }
        const diff = ((curr - prev) / prev) * 100;
        const isPositive = diff >= 0;
        const sign = isPositive ? '+' : '';
        return {
            text: `${sign}${diff.toFixed(1)}%`,
            isPositive,
            isNeutral: diff === 0
        };
    }

    function getOrCreateTooltip(container) {
        let tooltip = container.querySelector('.chart-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'chart-tooltip absolute pointer-events-none hidden text-xs rounded-xl px-3.5 py-2.5 transition-all duration-75 z-30';
            container.appendChild(tooltip);
        }
        return tooltip;
    }

    /**
     * Builds a continuous series spanning from since to until (by day or by month)
     */
    function generateDateRangeSeries(rawData, since, until, valueKey = 'count', defaultVal = 0, granularity = 'day') {
        if (!since || !until) return rawData || [];

        const isMonthly = granularity === 'month' || (rawData && rawData.length > 0 && rawData[0].day && rawData[0].day.length === 7);

        const dataMap = {};
        if (Array.isArray(rawData)) {
            rawData.forEach(item => {
                if (item && item.day) {
                    dataMap[item.day] = parseFloat(item[valueKey]) || 0;
                }
            });
        }

        const result = [];
        const [sY, sM, sD] = since.split('-').map(Number);
        const [uY, uM, uD] = until.split('-').map(Number);

        if (isMonthly) {
            let currY = sY;
            let currM = sM;
            const endY = uY;
            const endM = uM;

            let maxMonths = 120;
            while ((currY < endY || (currY === endY && currM <= endM)) && maxMonths > 0) {
                maxMonths--;
                const ymStr = `${currY}-${String(currM).padStart(2, '0')}`;
                const val = (ymStr in dataMap) ? dataMap[ymStr] : defaultVal;
                result.push({
                    day: ymStr,
                    [valueKey]: val
                });

                currM++;
                if (currM > 12) {
                    currM = 1;
                    currY++;
                }
            }
        } else {
            const curr = new Date(sY, sM - 1, sD);
            const end = new Date(uY, uM - 1, uD);

            let maxDays = 500;
            while (curr <= end && maxDays > 0) {
                maxDays--;
                const y = curr.getFullYear();
                const m = String(curr.getMonth() + 1).padStart(2, '0');
                const d = String(curr.getDate()).padStart(2, '0');
                const dayStr = `${y}-${m}-${d}`;

                const val = (dayStr in dataMap) ? dataMap[dayStr] : defaultVal;
                result.push({
                    day: dayStr,
                    [valueKey]: val
                });

                curr.setDate(curr.getDate() + 1);
            }
        }

        return result.length > 0 ? result : (rawData || []);
    }

    /**
     * Smooth Bezier Line & Area Chart for all 10 KPIs with Previous Period Comparison
     */
    function renderLineChart(containerId, rawData, valueKey = 'count', options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        const rect = container.getBoundingClientRect();
        const width = rect.width || 450;
        const height = rect.height || 220;

        const isPercent = options.isPercent || false;
        const isCurrency = options.isCurrency || false;
        const primaryColor = getThemeColor();
        const prevColor = getPreviousCurveColor();
        const textMuted = getMutedTextColor();
        const gridColor = getGridColor();

        // Current period series
        const defaultValue = options.defaultValue !== undefined ? options.defaultValue : 0;
        const granularity = options.granularity || 'day';
        const items = (options.since && options.until)
            ? generateDateRangeSeries(rawData, options.since, options.until, valueKey, defaultValue, granularity)
            : (rawData && rawData.length > 0 ? rawData : []);

        // Previous period series
        let prevItems = [];
        if (options.prevSince && options.prevUntil) {
            prevItems = generateDateRangeSeries(options.prevTrend, options.prevSince, options.prevUntil, valueKey, defaultValue, granularity);
        } else if (options.prevTrend && options.prevTrend.length > 0) {
            prevItems = options.prevTrend;
        }

        if (items.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">${options.emptyText || 'Aucune donnée'}</div>`;
            return;
        }

        const padding = { top: 22, right: 20, bottom: 28, left: isCurrency ? 55 : 42 };
        const chartW = Math.max(10, width - padding.left - padding.right);
        const chartH = Math.max(10, height - padding.top - padding.bottom);

        const currentValues = items.map(d => parseFloat(d[valueKey]) || 0);
        const previousValues = prevItems.map(d => parseFloat(d[valueKey]) || 0);

        let minVal = 0;
        let maxVal = isPercent ? 100 : Math.max(...currentValues, ...previousValues, 1);
        if (!isPercent && maxVal === minVal) {
            maxVal = minVal + 1;
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'w-full h-full overflow-visible');

        // Gradient Definition for Current Period
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const gradId = `grad-${containerId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const linearGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        linearGrad.setAttribute('id', gradId);
        linearGrad.setAttribute('x1', '0');
        linearGrad.setAttribute('y1', '0');
        linearGrad.setAttribute('x2', '0');
        linearGrad.setAttribute('y2', '1');

        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', primaryColor);
        stop1.setAttribute('stop-opacity', '0.28');

        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', primaryColor);
        stop2.setAttribute('stop-opacity', '0.0');

        linearGrad.appendChild(stop1);
        linearGrad.appendChild(stop2);
        defs.appendChild(linearGrad);
        svg.appendChild(defs);

        // Y-Axis Horizontal Grid Lines & Ticks
        const yTicks = isPercent ? 2 : 3;
        for (let r = 0; r <= yTicks; r++) {
            const ratio = (yTicks - r) / yTicks;
            const val = minVal + (maxVal - minVal) * ratio;
            const y = padding.top + (chartH / yTicks) * r;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', padding.left);
            line.setAttribute('x2', width - padding.right);
            line.setAttribute('y1', y);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', gridColor);
            line.setAttribute('stroke-dasharray', '2,4');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', padding.left - 8);
            text.setAttribute('y', y + 3.5);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('fill', textMuted);
            text.setAttribute('font-size', '10');
            text.setAttribute('font-weight', '500');
            if (isPercent) {
                text.textContent = `${Math.round(val)}%`;
            } else if (isCurrency) {
                text.textContent = formatCurrency(val);
            } else {
                text.textContent = formatNumber(Math.round(val));
            }
            svg.appendChild(text);
        }

        // Calculate Points Coordinates for Current Period
        const count = items.length;
        const stepX = count > 1 ? chartW / (count - 1) : 0;
        const points = items.map((item, idx) => {
            const val = parseFloat(item[valueKey]) || 0;
            const clampedVal = isPercent ? Math.max(0, Math.min(100, val)) : val;
            const ratio = maxVal > minVal ? (clampedVal - minVal) / (maxVal - minVal) : 0;
            const x = count === 1 ? padding.left + chartW / 2 : padding.left + idx * stepX;
            const y = padding.top + chartH - ratio * chartH;
            return { x, y, val: clampedVal, item };
        });

        // Calculate Points Coordinates for Previous Period (aligned along X axis)
        const prevPoints = [];
        if (prevItems.length > 0) {
            const prevCount = prevItems.length;
            const prevStepX = prevCount > 1 ? chartW / (prevCount - 1) : 0;
            prevItems.forEach((item, idx) => {
                const val = parseFloat(item[valueKey]) || 0;
                const clampedVal = isPercent ? Math.max(0, Math.min(100, val)) : val;
                const ratio = maxVal > minVal ? (clampedVal - minVal) / (maxVal - minVal) : 0;
                const x = prevCount === 1 ? padding.left + chartW / 2 : padding.left + idx * prevStepX;
                const y = padding.top + chartH - ratio * chartH;
                prevPoints.push({ x, y, val: clampedVal, item });
            });
        }

        // Helper to build cubic bezier string from points array
        function buildBezierPath(pts) {
            if (pts.length === 0) return '';
            if (pts.length === 1) return `M ${padding.left} ${pts[0].y} L ${width - padding.right} ${pts[0].y}`;
            let path = `M ${pts[0].x} ${pts[0].y}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i];
                const p1 = pts[i + 1];
                const cpX = (p0.x + p1.x) / 2;
                path += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
            }
            return path;
        }

        // 1. Render Previous Period Curve (Dashed line in background)
        if (prevPoints.length > 0) {
            const prevLineD = buildBezierPath(prevPoints);
            const prevStrokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            prevStrokePath.setAttribute('d', prevLineD);
            prevStrokePath.setAttribute('fill', 'none');
            prevStrokePath.setAttribute('stroke', prevColor);
            prevStrokePath.setAttribute('stroke-width', '1.8');
            prevStrokePath.setAttribute('stroke-dasharray', '4,4');
            prevStrokePath.setAttribute('stroke-linecap', 'round');
            prevStrokePath.setAttribute('stroke-linejoin', 'round');
            prevStrokePath.setAttribute('class', 'opacity-70');
            svg.appendChild(prevStrokePath);
        }

        // 2. Render Current Period Area & Stroke
        const currentLineD = buildBezierPath(points);
        let areaD = '';
        if (points.length === 1) {
            areaD = `M ${padding.left} ${points[0].y} L ${width - padding.right} ${points[0].y} L ${width - padding.right} ${padding.top + chartH} L ${padding.left} ${padding.top + chartH} Z`;
        } else {
            const lastP = points[points.length - 1];
            const firstP = points[0];
            areaD = `${currentLineD} L ${lastP.x} ${padding.top + chartH} L ${firstP.x} ${padding.top + chartH} Z`;
        }

        const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        areaPath.setAttribute('d', areaD);
        areaPath.setAttribute('fill', `url(#${gradId})`);
        svg.appendChild(areaPath);

        const strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        strokePath.setAttribute('d', currentLineD);
        strokePath.setAttribute('fill', 'none');
        strokePath.setAttribute('stroke', primaryColor);
        strokePath.setAttribute('stroke-width', '2.5');
        strokePath.setAttribute('stroke-linecap', 'round');
        strokePath.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(strokePath);

        // X-Axis Labels (Daily or Monthly)
        if (items.length > 0) {
            const isMonthly = items[0].day && items[0].day.length === 7;
            const startDateStr = items[0].day;
            const endDateStr = items[items.length - 1].day;

            if (isMonthly && items.length <= 12) {
                const step = items.length > 8 ? 2 : 1;
                for (let i = 0; i < items.length; i += step) {
                    const dStr = items[i].day;
                    const xPos = items.length === 1 ? padding.left + chartW / 2 : padding.left + i * (chartW / (items.length - 1));
                    const anchor = i === 0 ? 'start' : (i >= items.length - 1 ? 'end' : 'middle');
                    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    textEl.setAttribute('x', xPos);
                    textEl.setAttribute('y', height - 6);
                    textEl.setAttribute('text-anchor', anchor);
                    textEl.setAttribute('fill', textMuted);
                    textEl.setAttribute('font-size', '10');
                    textEl.setAttribute('font-weight', '600');
                    textEl.textContent = formatDateShortFr(dStr);
                    svg.appendChild(textEl);
                }
            } else {
                const tFirst = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tFirst.setAttribute('x', padding.left);
                tFirst.setAttribute('y', height - 6);
                tFirst.setAttribute('text-anchor', 'start');
                tFirst.setAttribute('fill', textMuted);
                tFirst.setAttribute('font-size', '10');
                tFirst.setAttribute('font-weight', '600');
                tFirst.textContent = formatDateShortFr(startDateStr);
                svg.appendChild(tFirst);

                if (items.length >= 8) {
                    const midIdx = Math.floor(items.length / 2);
                    const midDateStr = items[midIdx].day;
                    const tMid = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    tMid.setAttribute('x', padding.left + chartW / 2);
                    tMid.setAttribute('y', height - 6);
                    tMid.setAttribute('text-anchor', 'middle');
                    tMid.setAttribute('fill', textMuted);
                    tMid.setAttribute('font-size', '10');
                    tMid.setAttribute('font-weight', '600');
                    tMid.textContent = formatDateShortFr(midDateStr);
                    svg.appendChild(tMid);
                }

                if (items.length > 1) {
                    const tLast = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    tLast.setAttribute('x', width - padding.right);
                    tLast.setAttribute('y', height - 6);
                    tLast.setAttribute('text-anchor', 'end');
                    tLast.setAttribute('fill', textMuted);
                    tLast.setAttribute('font-size', '10');
                    tLast.setAttribute('font-weight', '600');
                    tLast.textContent = formatDateShortFr(endDateStr);
                    svg.appendChild(tLast);
                }
            }
        }

        // Hover Guide Line & Indicators (Current + Previous)
        const guideGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        guideGroup.setAttribute('class', 'opacity-0 transition-opacity duration-150 pointer-events-none');

        const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guideLine.setAttribute('y1', padding.top);
        guideLine.setAttribute('y2', padding.top + chartH);
        guideLine.setAttribute('stroke', '#848796');
        guideLine.setAttribute('stroke-dasharray', '3,3');
        guideLine.setAttribute('stroke-width', '1.5');
        guideGroup.appendChild(guideLine);

        // Indicator dot for previous period
        const prevCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        prevCircle.setAttribute('r', '3.5');
        prevCircle.setAttribute('fill', '#ffffff');
        prevCircle.setAttribute('stroke', prevColor);
        prevCircle.setAttribute('stroke-width', '2');
        guideGroup.appendChild(prevCircle);

        // Indicator dot for current period
        const guideCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        guideCircle.setAttribute('r', '4');
        guideCircle.setAttribute('fill', '#ffffff');
        guideCircle.setAttribute('stroke', primaryColor);
        guideCircle.setAttribute('stroke-width', '2.5');
        guideGroup.appendChild(guideCircle);

        svg.appendChild(guideGroup);
        container.appendChild(svg);

        // Tooltip Interaction with Comparative Data
        const tooltip = getOrCreateTooltip(container);
        container.onmousemove = function(e) {
            const containerRect = container.getBoundingClientRect();
            const mouseX = e.clientX - containerRect.left;

            if (mouseX < padding.left || mouseX > width - padding.right || points.length === 0) {
                tooltip.classList.add('hidden');
                guideGroup.classList.add('opacity-0');
                return;
            }

            let closestIdx = 0;
            let minDist = Math.abs(mouseX - points[0].x);
            for (let i = 1; i < points.length; i++) {
                const dist = Math.abs(mouseX - points[i].x);
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = i;
                }
            }

            const closest = points[closestIdx];
            const prevClosest = prevPoints[closestIdx] || null;

            guideLine.setAttribute('x1', closest.x);
            guideLine.setAttribute('x2', closest.x);
            guideCircle.setAttribute('cx', closest.x);
            guideCircle.setAttribute('cy', closest.y);

            if (prevClosest) {
                prevCircle.setAttribute('cx', closest.x);
                prevCircle.setAttribute('cy', prevClosest.y);
                prevCircle.style.display = 'block';
            } else {
                prevCircle.style.display = 'none';
            }

            guideGroup.classList.remove('opacity-0');

            function valToStr(v) {
                if (isPercent) return `${v.toFixed(1)}%`;
                if (isCurrency) return formatCurrency(v);
                return formatNumber(v);
            }

            const currValFormatted = valToStr(closest.val);
            const prevValFormatted = prevClosest ? valToStr(prevClosest.val) : null;
            const variation = prevClosest ? formatVariation(closest.val, prevClosest.val) : null;

            const labelTitle = options.label || 'Valeur';
            const theme = getTooltipTheme();

            tooltip.style.backgroundColor = theme.bg;
            tooltip.style.borderColor = theme.border;
            tooltip.style.borderWidth = '1px';
            tooltip.style.borderStyle = 'solid';
            tooltip.style.boxShadow = theme.shadow;

            let prevHtml = '';
            if (prevClosest) {
                const varColor = variation.isNeutral ? theme.label : (variation.isPositive ? '#10b981' : '#f43f5e');
                prevHtml = `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 11px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed ${theme.divider};">
                        <span style="color: ${theme.prevLabel}; font-weight: 500;">Précédent (${formatDateShortFr(prevClosest.item.day)}):</span>
                        <span style="font-weight: 700; color: ${theme.prevValue};">${prevValFormatted}</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px; font-size: 10px; margin-top: 4px; font-weight: 700; color: ${varColor};">
                        <span>Évolution : ${variation.text}</span>
                    </div>
                `;
            }

            tooltip.innerHTML = `
                <div style="font-weight: 700; color: ${theme.dateText}; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid ${theme.divider}; font-size: 11px;">
                    ${formatDateLongFr(closest.item.day)}
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 11px;">
                    <span style="color: ${theme.label}; font-weight: 500;">${labelTitle} actuel :</span>
                    <span style="font-weight: 800; color: ${theme.value};">${currValFormatted}</span>
                </div>
                ${prevHtml}
            `;
            tooltip.classList.remove('hidden');

            const tooltipW = tooltip.offsetWidth;
            let leftPos = closest.x - tooltipW / 2;
            if (leftPos < 10) leftPos = 10;
            if (leftPos + tooltipW > containerRect.width - 10) leftPos = containerRect.width - tooltipW - 10;
            tooltip.style.left = `${leftPos}px`;
            tooltip.style.top = `15px`;
        };

        container.onmouseleave = function() {
            tooltip.classList.add('hidden');
            guideGroup.classList.add('opacity-0');
        };
    }

    /**
     * Mini Sparkline Bezier Curve (for Top Summary Cards)
     */
    function renderSparkline(svgId, points) {
        const svg = document.getElementById(svgId);
        if (!svg) return;
        svg.innerHTML = '';

        if (!points || points.length === 0) return;

        const samples = points.slice(-12);
        const maxVal = Math.max(...samples, 1);
        const minVal = 0;
        const count = samples.length;

        const width = 72;
        const height = 28;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const primaryColor = getThemeColor();
        const padding = { top: 3, bottom: 3, left: 2, right: 2 };
        const w = width - padding.left - padding.right;
        const h = height - padding.top - padding.bottom;
        const stepX = count > 1 ? w / (count - 1) : 0;

        const coords = samples.map((val, idx) => {
            const ratio = maxVal > minVal ? (val - minVal) / (maxVal - minVal) : 0;
            const x = count === 1 ? padding.left + w / 2 : padding.left + idx * stepX;
            const y = padding.top + h - ratio * h;
            return { x, y };
        });

        // Gradient
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const gradId = `sparkline-grad-${svgId}`;
        const linearGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        linearGrad.setAttribute('id', gradId);
        linearGrad.setAttribute('x1', '0');
        linearGrad.setAttribute('y1', '0');
        linearGrad.setAttribute('x2', '0');
        linearGrad.setAttribute('y2', '1');

        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', primaryColor);
        stop1.setAttribute('stop-opacity', '0.35');

        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', primaryColor);
        stop2.setAttribute('stop-opacity', '0.0');

        linearGrad.appendChild(stop1);
        linearGrad.appendChild(stop2);
        defs.appendChild(linearGrad);
        svg.appendChild(defs);

        // Bezier Path
        let lineD = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 0; i < coords.length - 1; i++) {
            const p0 = coords[i];
            const p1 = coords[i + 1];
            const cpX = (p0.x + p1.x) / 2;
            lineD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
        }

        const areaD = `${lineD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

        const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        areaPath.setAttribute('d', areaD);
        areaPath.setAttribute('fill', `url(#${gradId})`);
        svg.appendChild(areaPath);

        const strokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        strokePath.setAttribute('d', lineD);
        strokePath.setAttribute('fill', 'none');
        strokePath.setAttribute('stroke', primaryColor);
        strokePath.setAttribute('stroke-width', '2');
        strokePath.setAttribute('stroke-linecap', 'round');
        strokePath.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(strokePath);
    }

    const PALETTE = [
        '#ff6b00', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
        '#ec4899', '#06b6d4', '#6366f1', '#14b8a6', '#f97316', '#64748b'
    ];

    /**
     * Modern Donut Chart (Pure SVG + Rich Legend & Tooltip)
     */
    function renderDonutChart(containerId, items, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        if (!items || items.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">${options.emptyText || 'Aucune donnée'}</div>`;
            return;
        }

        const total = items.reduce((acc, it) => acc + (parseFloat(it.count) || 0), 0);
        if (total === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">Total égal à 0</div>`;
            return;
        }

        const tooltip = getOrCreateTooltip(container);
        const theme = getTooltipTheme();
        const textMuted = getMutedTextColor();
        const isDark = document.documentElement.classList.contains('dark');

        const wrapper = document.createElement('div');
        wrapper.className = 'w-full h-full flex flex-col md:flex-row items-center justify-between gap-4 p-2';

        // SVG Donut Container
        const donutBox = document.createElement('div');
        donutBox.className = 'relative flex-shrink-0 flex items-center justify-center';
        donutBox.style.width = '180px';
        donutBox.style.height = '180px';

        const size = 180;
        const cx = size / 2;
        const cy = size / 2;
        const outerR = 75;
        const innerR = 48;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', 'w-full h-full overflow-visible');

        let currentAngle = -Math.PI / 2; // Start from top (12 o'clock)

        items.forEach((item, idx) => {
            const val = parseFloat(item.count) || 0;
            const sliceAngle = (val / total) * 2 * Math.PI;
            const endAngle = currentAngle + sliceAngle;
            const color = item.color || PALETTE[idx % PALETTE.length];

            const x1 = cx + outerR * Math.cos(currentAngle);
            const y1 = cy + outerR * Math.sin(currentAngle);
            const x2 = cx + outerR * Math.cos(endAngle);
            const y2 = cy + outerR * Math.sin(endAngle);

            const x3 = cx + innerR * Math.cos(endAngle);
            const y3 = cy + innerR * Math.sin(endAngle);
            const x4 = cx + innerR * Math.cos(currentAngle);
            const y4 = cy + innerR * Math.sin(currentAngle);

            const largeArc = sliceAngle > Math.PI ? 1 : 0;

            let pathD;
            if (items.length === 1 || Math.abs(sliceAngle - 2 * Math.PI) < 0.001) {
                // Full circle ring
                pathD = `
                    M ${cx} ${cy - outerR}
                    A ${outerR} ${outerR} 0 1 0 ${cx} ${cy + outerR}
                    A ${outerR} ${outerR} 0 1 0 ${cx} ${cy - outerR}
                    M ${cx} ${cy - innerR}
                    A ${innerR} ${innerR} 0 1 1 ${cx} ${cy + innerR}
                    A ${innerR} ${innerR} 0 1 1 ${cx} ${cy - innerR}
                    Z
                `;
            } else {
                pathD = `
                    M ${x1} ${y1}
                    A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}
                    L ${x3} ${y3}
                    A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}
                    Z
                `;
            }

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathD);
            path.setAttribute('fill', color);
            path.setAttribute('stroke', isDark ? '#1a1b22' : '#ffffff');
            path.setAttribute('stroke-width', '2');
            path.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
            path.style.transformOrigin = `${cx}px ${cy}px`;
            path.style.cursor = 'pointer';

            path.onmouseenter = function(e) {
                path.style.transform = 'scale(1.04)';
                path.style.opacity = '0.9';

                tooltip.style.backgroundColor = theme.bg;
                tooltip.style.borderColor = theme.border;
                tooltip.style.borderWidth = '1px';
                tooltip.style.borderStyle = 'solid';
                tooltip.style.boxShadow = theme.shadow;
                tooltip.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 700; color: ${theme.dateText}; font-size: 11px;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>
                        ${item.label}
                    </div>
                    <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
                        <span style="color: ${theme.label}; font-weight: 500;">Volume :</span>
                        <span style="font-weight: 800; color: ${theme.value};">${formatNumber(item.count)} (${item.percentage}%)</span>
                    </div>
                `;
                tooltip.classList.remove('hidden');
                tooltip.style.left = `${e.offsetX + 10}px`;
                tooltip.style.top = `${e.offsetY - 20}px`;
            };

            path.onmousemove = function(e) {
                tooltip.style.left = `${e.offsetX + 10}px`;
                tooltip.style.top = `${e.offsetY - 20}px`;
            };

            path.onmouseleave = function() {
                path.style.transform = 'scale(1)';
                path.style.opacity = '1';
                tooltip.classList.add('hidden');
            };

            svg.appendChild(path);
            currentAngle = endAngle;
        });

        // Center Text
        const centerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        centerGroup.setAttribute('class', 'pointer-events-none');

        const centerValText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        centerValText.setAttribute('x', cx);
        centerValText.setAttribute('y', cy - 2);
        centerValText.setAttribute('text-anchor', 'middle');
        centerValText.setAttribute('dominant-baseline', 'middle');
        centerValText.setAttribute('font-size', '16');
        centerValText.setAttribute('font-weight', '800');
        centerValText.setAttribute('fill', isDark ? '#ffffff' : '#111827');
        centerValText.textContent = formatNumber(total);
        centerGroup.appendChild(centerValText);

        const centerSubText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        centerSubText.setAttribute('x', cx);
        centerSubText.setAttribute('y', cy + 14);
        centerSubText.setAttribute('text-anchor', 'middle');
        centerSubText.setAttribute('dominant-baseline', 'middle');
        centerSubText.setAttribute('font-size', '9');
        centerSubText.setAttribute('font-weight', '600');
        centerSubText.setAttribute('fill', textMuted);
        centerSubText.textContent = options.centerLabel || 'TOTAL';
        centerGroup.appendChild(centerSubText);

        svg.appendChild(centerGroup);
        donutBox.appendChild(svg);
        wrapper.appendChild(donutBox);

        // Legend List
        const legendBox = document.createElement('div');
        legendBox.className = 'w-full md:flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto max-h-[200px] pr-1';

        items.forEach((item, idx) => {
            const color = item.color || PALETTE[idx % PALETTE.length];
            const legendItem = document.createElement('div');
            legendItem.className = 'flex items-center justify-between p-2 rounded-xl bg-[var(--bg-card-raised)]/60 hover:bg-[var(--bg-card-raised)] transition-colors border border-[var(--border-subtle)] text-xs';
            legendItem.innerHTML = `
                <div class="flex items-center gap-2 truncate pr-2">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${color};"></span>
                    <span class="font-medium text-[var(--text-main)] truncate" title="${item.label}">${item.label}</span>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 font-mono text-[11px]">
                    <span class="font-bold text-[var(--text-main)]">${formatNumber(item.count)}</span>
                    <span class="px-1.5 py-0.5 rounded-md bg-[var(--border-subtle)] text-[var(--text-muted)] text-[10px] font-bold">${item.percentage}%</span>
                </div>
            `;
            legendBox.appendChild(legendItem);
        });

        wrapper.appendChild(legendBox);
        container.appendChild(wrapper);
    }

    /**
     * Ranked Horizontal Bar Chart (Top Pages / Ranked Lists)
     */
    function renderHorizontalBarChart(containerId, items, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        if (!items || items.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">${options.emptyText || 'Aucune donnée'}</div>`;
            return;
        }

        const maxVal = Math.max(...items.map(it => parseFloat(it.views || it.count) || 0), 1);
        const primaryColor = getThemeColor();

        const listContainer = document.createElement('div');
        listContainer.className = 'w-full h-full flex flex-col gap-2 overflow-y-auto max-h-[260px] pr-1';

        items.forEach((item, idx) => {
            const val = parseFloat(item.views || item.count) || 0;
            const pct = item.percentage !== undefined ? item.percentage : ((val / maxVal) * 100).toFixed(1);
            const barWidthRatio = Math.max(2, (val / maxVal) * 100);
            const rank = item.rank || (idx + 1);

            let rankClass = 'bg-[var(--bg-card-raised)] text-[var(--text-muted)] border-[var(--border-subtle)]';
            if (rank === 1) rankClass = 'bg-amber-500/20 text-amber-500 border-amber-500/30';
            else if (rank === 2) rankClass = 'bg-slate-400/20 text-slate-400 border-slate-400/30';
            else if (rank === 3) rankClass = 'bg-amber-700/20 text-amber-600 border-amber-700/30';

            const row = document.createElement('div');
            row.className = 'group p-2 rounded-xl bg-[var(--bg-card-raised)]/40 hover:bg-[var(--bg-card-raised)] border border-[var(--border-subtle)] transition-all flex flex-col gap-1.5';
            row.innerHTML = `
                <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2 truncate pr-2">
                        <span class="w-5 h-5 flex items-center justify-center rounded-lg border text-[10px] font-black flex-shrink-0 ${rankClass}">
                            ${rank}
                        </span>
                        <span class="font-semibold text-[var(--text-main)] truncate" title="${item.label}">${item.label}</span>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0 font-mono text-[11px]">
                        <span class="font-bold text-[var(--text-main)]">${formatNumber(val)} ${options.unitLabel || 'vues'}</span>
                        <span class="px-1.5 py-0.5 rounded-md bg-[var(--border-subtle)] text-[var(--text-muted)] text-[10px] font-bold">${pct}%</span>
                    </div>
                </div>
                <div class="w-full h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500" style="width: ${barWidthRatio}%; background: linear-gradient(90deg, ${primaryColor}, #ff944d);"></div>
                </div>
            `;
            listContainer.appendChild(row);
        });

        container.appendChild(listContainer);
    }

    /**
     * Histogram Chart (Time-to-Value buckets: <1h, 1-6h, 6-24h, 1-3j, >3j)
     */
    function renderHistogramChart(containerId, buckets, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        if (!buckets || buckets.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">${options.emptyText || 'Aucune donnée'}</div>`;
            return;
        }

        const rect = container.getBoundingClientRect();
        const width = rect.width || 450;
        const height = rect.height || 220;

        const maxVal = Math.max(...buckets.map(b => parseFloat(b.count) || 0), 1);
        const primaryColor = getThemeColor();
        const textMuted = getMutedTextColor();
        const gridColor = getGridColor();
        const theme = getTooltipTheme();
        const tooltip = getOrCreateTooltip(container);
        const isDark = document.documentElement.classList.contains('dark');

        const padding = { top: 35, right: 20, bottom: 35, left: 35 };
        const chartW = Math.max(10, width - padding.left - padding.right);
        const chartH = Math.max(10, height - padding.top - padding.bottom);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'w-full h-full overflow-visible');

        // Y Grid Lines (3 levels)
        for (let r = 0; r <= 3; r++) {
            const ratio = (3 - r) / 3;
            const y = padding.top + (chartH / 3) * r;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', padding.left);
            line.setAttribute('x2', width - padding.right);
            line.setAttribute('y1', y);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', gridColor);
            line.setAttribute('stroke-dasharray', '2,4');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        }

        const count = buckets.length;
        const colWidth = Math.min(65, (chartW / count) * 0.65);
        const colStep = chartW / count;

        buckets.forEach((b, idx) => {
            const val = parseFloat(b.count) || 0;
            const barH = (val / maxVal) * chartH;
            const x = padding.left + idx * colStep + (colStep - colWidth) / 2;
            const y = padding.top + chartH - barH;

            // Gradient per bar
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const gId = `hist-grad-${containerId}-${idx}`;
            const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
            grad.setAttribute('id', gId);
            grad.setAttribute('x1', '0');
            grad.setAttribute('y1', '0');
            grad.setAttribute('x2', '0');
            grad.setAttribute('y2', '1');

            const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            s1.setAttribute('offset', '0%');
            s1.setAttribute('stop-color', primaryColor);
            s1.setAttribute('stop-opacity', '1');

            const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
            s2.setAttribute('offset', '100%');
            s2.setAttribute('stop-color', primaryColor);
            s2.setAttribute('stop-opacity', '0.45');

            grad.appendChild(s1);
            grad.appendChild(s2);
            defs.appendChild(grad);
            svg.appendChild(defs);

            // Bar Rect
            const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rectEl.setAttribute('x', x);
            rectEl.setAttribute('y', y);
            rectEl.setAttribute('width', colWidth);
            rectEl.setAttribute('height', Math.max(3, barH));
            rectEl.setAttribute('rx', '6');
            rectEl.setAttribute('ry', '6');
            rectEl.setAttribute('fill', `url(#${gId})`);
            rectEl.style.transition = 'opacity 0.15s, transform 0.15s';
            rectEl.style.cursor = 'pointer';

            rectEl.onmouseenter = function(e) {
                rectEl.style.opacity = '0.85';
                tooltip.style.backgroundColor = theme.bg;
                tooltip.style.borderColor = theme.border;
                tooltip.style.borderWidth = '1px';
                tooltip.style.borderStyle = 'solid';
                tooltip.style.boxShadow = theme.shadow;
                tooltip.innerHTML = `
                    <div style="font-weight: 700; color: ${theme.dateText}; margin-bottom: 4px; font-size: 11px;">
                        Tranche : ${b.label}
                    </div>
                    <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
                        <span style="color: ${theme.label}; font-weight: 500;">Boutiques :</span>
                        <span style="font-weight: 800; color: ${theme.value};">${formatNumber(val)} (${b.percentage}%)</span>
                    </div>
                `;
                tooltip.classList.remove('hidden');
                tooltip.style.left = `${e.offsetX + 10}px`;
                tooltip.style.top = `${e.offsetY - 20}px`;
            };

            rectEl.onmousemove = function(e) {
                tooltip.style.left = `${e.offsetX + 10}px`;
                tooltip.style.top = `${e.offsetY - 20}px`;
            };

            rectEl.onmouseleave = function() {
                rectEl.style.opacity = '1';
                tooltip.classList.add('hidden');
            };

            svg.appendChild(rectEl);

            // Top Value & % Text
            const topText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            topText.setAttribute('x', x + colWidth / 2);
            topText.setAttribute('y', Math.max(14, y - 6));
            topText.setAttribute('text-anchor', 'middle');
            topText.setAttribute('font-size', '10');
            topText.setAttribute('font-weight', '700');
            topText.setAttribute('fill', isDark ? '#ffffff' : '#111827');
            topText.textContent = `${formatNumber(val)} (${b.percentage}%)`;
            svg.appendChild(topText);

            // Bottom Label
            const bText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            bText.setAttribute('x', x + colWidth / 2);
            bText.setAttribute('y', height - 10);
            bText.setAttribute('text-anchor', 'middle');
            bText.setAttribute('font-size', '10');
            bText.setAttribute('font-weight', '600');
            bText.setAttribute('fill', textMuted);
            bText.textContent = b.label;
            svg.appendChild(bText);
        });

        container.appendChild(svg);
    }

    /**
     * Grouped Bar Chart (Paid vs Non-Paying by Country)
     */
    function renderGroupedBarChart(containerId, countries, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        if (!countries || countries.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-[var(--text-faint)] font-medium">${options.emptyText || 'Aucune donnée'}</div>`;
            return;
        }

        const maxTotal = Math.max(...countries.map(c => parseFloat(c.total) || 0), 1);
        const primaryColor = getThemeColor();

        const listContainer = document.createElement('div');
        listContainer.className = 'w-full h-full flex flex-col gap-2.5 overflow-y-auto max-h-[260px] pr-1';

        countries.forEach(c => {
            const paidRatio = Math.max(0, (c.paid / maxTotal) * 100);
            const freeRatio = Math.max(0, (c.free / maxTotal) * 100);

            const row = document.createElement('div');
            row.className = 'group p-2.5 rounded-xl bg-[var(--bg-card-raised)]/50 hover:bg-[var(--bg-card-raised)] border border-[var(--border-subtle)] transition-all flex flex-col gap-1.5';
            row.innerHTML = `
                <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2 truncate pr-2">
                        <span class="font-bold text-[10px] px-1.5 py-0.5 rounded bg-[var(--border-subtle)] text-[var(--text-muted)] font-mono">${c.code}</span>
                        <span class="font-semibold text-[var(--text-main)] truncate">${c.name}</span>
                    </div>
                    <div class="flex items-center gap-3 font-mono text-[11px] flex-shrink-0">
                        <span class="font-bold text-[var(--primary-accent)]">${formatNumber(c.paid)} payant(s)</span>
                        <span class="text-[var(--text-faint)]">•</span>
                        <span class="font-medium text-[var(--text-muted)]">${formatNumber(c.free)} gratuit(s)</span>
                        <span class="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-bold text-[10px]">${c.paid_rate}%</span>
                    </div>
                </div>
                <div class="w-full flex h-2 rounded-full bg-[var(--border-subtle)] overflow-hidden gap-0.5">
                    <div class="h-full rounded-l-full" style="width: ${paidRatio}%; background-color: ${primaryColor};" title="Payants: ${c.paid}"></div>
                    <div class="h-full rounded-r-full bg-slate-500/40" style="width: ${freeRatio}%;" title="Gratuits: ${c.free}"></div>
                </div>
            `;
            listContainer.appendChild(row);
        });

        container.appendChild(listContainer);
    }

    return {
        renderLineChart,
        renderSparkline,
        renderDonutChart,
        renderHorizontalBarChart,
        renderHistogramChart,
        renderGroupedBarChart,
        formatDateShortFr,
        formatDateLongFr,
        formatNumber,
        formatCurrency,
        formatVariation,
        generateDateRangeSeries
    };
})();

