// 規則頁的「依遊戲分組」收合區塊。
// 每個 .game-group 裡有一個 .game-toggle 按鈕跟一個 .game-body 內容區,
// 預設收合(.game-body 有 hidden),點按鈕展開/收合,跟首頁「活動已結束」清單同一種互動。
(function () {
  document.querySelectorAll(".game-group").forEach((group) => {
    const toggle = group.querySelector(".game-toggle");
    const body = group.querySelector(".game-body");
    if (!toggle || !body) return;
    toggle.addEventListener("click", () => {
      const open = !group.classList.contains("open");
      group.classList.toggle("open", open);
      body.hidden = !open;
    });
  });
})();
