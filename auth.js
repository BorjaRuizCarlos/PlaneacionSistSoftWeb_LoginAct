// auth.js — Client-side auth guard
// Include this script on every protected page.
// It checks for a session token and redirects to login if missing.

(function () {
    const token = sessionStorage.getItem("authToken");
    if (!token) {
        alert("You must log in first.");
        // Redirect to login page (works from /pages/ or root)
        const isInPages = window.location.pathname.includes("/pages/");
        window.location.href = isInPages ? "../index.html" : "index.html";
    }
})();
