const logoutButton = document.getElementById('Button_Act');

function logout(event) {
    event.preventDefault();
    window.location.href='../index.html';
}

logoutButton.addEventListener('click', (event) => {
    logout(event);
});

/* Hide the nav link of the current page */
const currentPage = window.location.pathname.split('/').pop();
const navLinks = document.querySelectorAll('.nav_links li a');

navLinks.forEach(link => {
    const linkPage = link.getAttribute('href').split('/').pop();
    if (currentPage === linkPage) {
        link.parentElement.style.display = 'none';
    }
});
