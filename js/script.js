// document.getElementById('login').addEventListener('click', () => {
//   // Redirect to Netlify function to start OAuth flow
//   window.location.href = '.netlify/functions/spotifyapi';
// });

  document.getElementById('song').style.display = 'None';
  document.querySelector('.spotify').style.display = 'None';

  if (document.querySelector('.projects').clientWidth <= 450) {
    document.getElementById('proj').textContent = "PROJECTS | SWIPE TO EXPLORE ->"
  }
  
  window.addEventListener("load", () => {
  const intro = document.querySelector(".p-intro");
  intro.style.display = "none";
  // Force reflow
  void intro.offsetWidth;
  intro.style.display = "";
});