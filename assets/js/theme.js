/**
 * Theme Management (Dark / Light Mode)
 */
(function() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    
    function applyTheme(isDark) {
        if (isDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('nealens_theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('nealens_theme', 'light');
        }
        // Dispatch custom event for charts to redraw with updated theme colors
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isDark } }));
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            const isDark = document.documentElement.classList.contains('dark');
            applyTheme(!isDark);
        });
    }
})();
