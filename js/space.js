// Builds the fixed space backdrop (stars) behind the whole site.
(function () {
    var bg = document.createElement("div");
    bg.className = "space-bg";
    bg.setAttribute("aria-hidden", "true");

    var small = window.innerWidth < 640;
    var starCount = small ? 45 : 90;
    for (var i = 0; i < starCount; i++) {
        var s = document.createElement("span");
        s.className = "space-star";
        var size = Math.random() < 0.8 ? 1 + Math.random() : 2.5 + Math.random();
        s.style.cssText = "left:" + (Math.random() * 100) + "%;top:" + (Math.random() * 100) + "%;" +
            "width:" + size + "px;height:" + size + "px;" +
            "--d:" + (3 + Math.random() * 4) + "s;--delay:-" + (Math.random() * 6) + "s";
        bg.appendChild(s);
    }

    document.body.insertBefore(bg, document.body.firstChild);
})();
