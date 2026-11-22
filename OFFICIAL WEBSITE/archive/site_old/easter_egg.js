// Hidden "Behind PsycheScan" panel: clicking the sidebar logo opens a modal with
// the research team, the demo-sensor toggle, and a small Snake game.
(function () {
    const SNAKE_BEST_KEY = "psychescan_snake_best_v1";
    const GRID = 16;          // cells per side
    const TICK_MS = 120;      // game speed
    const DIRS = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 }
    };
    const KEY_DIRS = {
        ArrowUp: "up", KeyW: "up",
        ArrowDown: "down", KeyS: "down",
        ArrowLeft: "left", KeyA: "left",
        ArrowRight: "right", KeyD: "right"
    };

    const el = id => document.getElementById(id);
    let lastFocus = null;

    const game = {
        snake: [],
        dir: "right",
        queue: [],
        food: null,
        score: 0,
        best: 0,
        timer: null,
        running: false,
        over: false
    };

    function readBest() {
        try {
            return Number(localStorage.getItem(SNAKE_BEST_KEY)) || 0;
        } catch {
            return 0;
        }
    }

    function writeBest(value) {
        try {
            localStorage.setItem(SNAKE_BEST_KEY, String(value));
        } catch {
            // Storage unavailable (private window); best score just won't persist.
        }
    }

    function cssVar(name, fallback) {
        const value = getComputedStyle(document.body).getPropertyValue(name).trim();
        return value || fallback;
    }

    function updateScore() {
        const badge = el("snakeScore");
        if (badge) badge.textContent = `Score ${game.score} · Best ${game.best}`;
    }

    function setHint(text) {
        const hint = el("snakeHint");
        if (hint) hint.textContent = text;
    }

    function setPlayLabel(text) {
        const button = el("snakePlayBtn");
        if (!button) return;
        const label = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
        if (label) label.textContent = text;
        else button.append(text);
    }

    function placeFood() {
        const free = [];
        for (let y = 0; y < GRID; y += 1) {
            for (let x = 0; x < GRID; x += 1) {
                if (!game.snake.some(part => part.x === x && part.y === y)) free.push({ x, y });
            }
        }
        game.food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    }

    function resetGame() {
        const mid = Math.floor(GRID / 2);
        game.snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
        game.dir = "right";
        game.queue = [];
        game.score = 0;
        game.over = false;
        placeFood();
        updateScore();
    }

    function draw() {
        const canvas = el("snakeCanvas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const cell = canvas.width / GRID;
        const accent = cssVar("--accent", "#7c5cff");
        const line = cssVar("--line", "rgba(148,163,184,0.2)");

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        for (let i = 1; i < GRID; i += 1) {
            ctx.beginPath();
            ctx.moveTo(i * cell + 0.5, 0);
            ctx.lineTo(i * cell + 0.5, canvas.height);
            ctx.moveTo(0, i * cell + 0.5);
            ctx.lineTo(canvas.width, i * cell + 0.5);
            ctx.stroke();
        }

        if (game.food) {
            ctx.fillStyle = "#f59e0b";
            ctx.beginPath();
            ctx.arc((game.food.x + 0.5) * cell, (game.food.y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
            ctx.fill();
        }

        game.snake.forEach((part, index) => {
            ctx.globalAlpha = index === 0 ? 1 : Math.max(0.45, 1 - index * 0.03);
            ctx.fillStyle = accent;
            ctx.fillRect(part.x * cell + 2, part.y * cell + 2, cell - 4, cell - 4);
        });
        ctx.globalAlpha = 1;
    }

    function step() {
        // Apply one queued turn per tick, never reversing straight into the body.
        while (game.queue.length) {
            const next = game.queue.shift();
            const a = DIRS[next];
            const b = DIRS[game.dir];
            if (a.x + b.x !== 0 || a.y + b.y !== 0) {
                game.dir = next;
                break;
            }
        }
        const move = DIRS[game.dir];
        const head = { x: game.snake[0].x + move.x, y: game.snake[0].y + move.y };
        const eating = game.food && head.x === game.food.x && head.y === game.food.y;
        const body = eating ? game.snake : game.snake.slice(0, -1);
        const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
        const hitSelf = body.some(part => part.x === head.x && part.y === head.y);
        if (hitWall || hitSelf) {
            endGame();
            return;
        }
        game.snake = [head, ...body];
        if (eating) {
            game.score += 1;
            if (game.score > game.best) {
                game.best = game.score;
                writeBest(game.best);
            }
            updateScore();
            placeFood();
            if (!game.food) {
                endGame(true);
                return;
            }
        }
        draw();
    }

    function startLoop() {
        stopLoop();
        game.running = true;
        game.timer = setInterval(step, TICK_MS);
        setPlayLabel("Pause");
        setHint("Arrow keys or WASD to steer. Space pauses.");
    }

    function stopLoop() {
        clearInterval(game.timer);
        game.timer = null;
        game.running = false;
    }

    function pauseGame() {
        if (!game.running) return;
        stopLoop();
        setPlayLabel("Resume");
        setHint("Paused. Press Resume or Space to continue.");
    }

    function endGame(won = false) {
        stopLoop();
        game.over = true;
        draw();
        setPlayLabel("Play again");
        setHint(won ? `You filled the board! Score ${game.score}.` : `Game over. Score ${game.score}.`);
    }

    function togglePlay() {
        if (game.running) {
            pauseGame();
            return;
        }
        if (game.over || !game.snake.length) resetGame();
        draw();
        startLoop();
    }

    function queueDirection(dir) {
        if (!DIRS[dir]) return;
        if (game.queue.length < 3) game.queue.push(dir);
        if (!game.running && !game.over && game.snake.length) startLoop();
    }

    function isOpen() {
        return el("secretModal")?.classList.contains("show");
    }

    function openModal() {
        const modal = el("secretModal");
        if (!modal) return;
        lastFocus = document.activeElement;
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        if (!game.snake.length) resetGame();
        draw();
        el("closeSecretModalBtn")?.focus();
    }

    function closeModal() {
        const modal = el("secretModal");
        if (!modal) return;
        pauseGame();
        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    function init() {
        const logo = el("secretLogoBtn");
        const modal = el("secretModal");
        if (!logo || !modal) return;
        game.best = readBest();
        updateScore();

        logo.addEventListener("click", openModal);
        el("closeSecretModalBtn")?.addEventListener("click", closeModal);
        modal.addEventListener("click", event => {
            if (event.target === modal) closeModal();
        });
        el("snakePlayBtn")?.addEventListener("click", togglePlay);
        modal.querySelectorAll("[data-snake-dir]").forEach(button => {
            button.addEventListener("click", () => queueDirection(button.dataset.snakeDir));
        });

        document.addEventListener("keydown", event => {
            if (!isOpen()) return;
            if (event.key === "Escape") {
                closeModal();
                return;
            }
            // Leave typing in form fields alone.
            if (event.target.closest("input, select, textarea")) return;
            if (KEY_DIRS[event.code]) {
                event.preventDefault();
                queueDirection(KEY_DIRS[event.code]);
            } else if (event.code === "Space" && !event.target.closest("button")) {
                event.preventDefault();
                togglePlay();
            }
        });
    }

    document.addEventListener("DOMContentLoaded", init, { once: true });
})();
