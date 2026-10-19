
/* =========================================================
   MUKUBA UNIVERSITY CLASSROOM MANAGEMENT SYSTEM
   Complete app.js — corrected navigation
========================================================= */

const SUPABASE_URL = "https://mbieizajeifupzuokefx.supabase.co";
const SUPABASE_KEY = "sb_publishable_0ns5_TamqKpwft8NV1rkKw_MebMI8d0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let profile = null;
let programs = [];
let classrooms = [];
let posts = [];

let realtimeChannel = null;
let refreshTimer = null;
let clockTimer = null;
let refreshInProgress = false;
let dashboardLoading = false;
let authReady = false;
let currentPageId = "overviewPage";
let pageHistory = [];
let lastRealtimeNoticeAt = 0;

const $ = id => document.getElementById(id);

const normalizedRole = () => String(profile?.role || "").trim().toLowerCase();

const isAdmin = () => normalizedRole() === "admin";

const canPost = () =>
    ["admin", "class_rep", "lecturer"].includes(normalizedRole());

/* =========================================================
   MESSAGES AND HELPERS
========================================================= */

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function notify(message, type = "info") {
    const region = $("toastRegion");
    const messageBox = $("message");

    if (region) {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        region.appendChild(toast);

        window.setTimeout(() => toast.remove(), 5000);
        return;
    }

    if (messageBox) {
        messageBox.textContent = message;
        messageBox.className = `message ${type}`;
        messageBox.hidden = false;

        window.setTimeout(() => {
            messageBox.hidden = true;
        }, 5000);
        return;
    }

    alert(message);
}

function friendlyError(error) {
    if (!error) return "Something went wrong. Please try again.";

    if (
        error.code === "23P01" ||
        String(error.message || "").includes(
            "no_overlapping_classroom_lectures"
        )
    ) {
        return "This classroom has a conflicting lecture. Please choose another classroom.";
    }

    if (error.code === "23505") {
        return "This record already exists.";
    }

    if (error.code === "42501") {
        return "You do not have permission to perform this action.";
    }

    const message = String(error.message || "").toLowerCase();

    if (message.includes("invalid login")) {
        return "Incorrect email or password.";
    }

    if (message.includes("email not confirmed")) {
        return "Please confirm your email before signing in.";
    }

    if (
        message.includes("row-level security") ||
        message.includes("permission denied")
    ) {
        return "Permission denied. Please check your Supabase access policies.";
    }

    return error.message || "An unexpected error occurred.";
}

function setVisible(element, visible) {
    if (!element) return;

    element.hidden = !visible;
    element.classList.toggle("hidden", !visible);

    // Remove the inline display override when showing an element so its
    // original CSS layout (grid, flex, inline-flex, etc.) is preserved.
    if (visible) {
        element.style.removeProperty("display");
    } else {
        element.style.setProperty("display", "none", "important");
    }
}

function showAuth() {
    setVisible($("authSection"), true);
    setVisible($("resetPasswordSection"), false);
    setVisible($("dashboard"), false);
    setVisible($("logoutButton"), false);
    showAuthView("login");
}

function showResetPassword() {
    setVisible($("authSection"), false);
    setVisible($("resetPasswordSection"), true);
    setVisible($("dashboard"), false);
}

function showDashboard() {
    setVisible($("authSection"), false);
    setVisible($("resetPasswordSection"), false);
    setVisible($("dashboard"), true);
    setVisible($("logoutButton"), true);

    showPage("overviewPage");
}

function updateYear() {
    if ($("currentYear")) {
        $("currentYear").textContent = new Date().getFullYear();
    }
}

/* =========================================================
   LOAD PROGRAMMES
========================================================= */

async function loadPrograms() {
    const { data, error } = await db
        .from("programs")
        .select("id, name")
        .order("name");

    if (error) throw error;

    programs = data || [];

    [$("signupProgram"), $("targetProgram")].forEach(select => {
        if (!select) return;

        const oldValue = select.value;

        select.replaceChildren(
            new Option("Select a programme", "")
        );

        programs.forEach(program => {
            select.add(new Option(program.name, program.id));
        });

        if (
            oldValue &&
            programs.some(program => String(program.id) === oldValue)
        ) {
            select.value = oldValue;
        }
    });
}

/* =========================================================
   LOAD USER PROFILE
========================================================= */

async function loadProfile() {
    if (!currentUser) {
        profile = null;
        return;
    }

    const { data, error } = await db
        .from("profiles")
        .select("id, full_name, role, program_id")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error(
            "Your user profile could not be found. Please contact the administrator."
        );
    }

    profile = data;

    const program = programs.find(
        item => String(item.id) === String(profile.program_id)
    );

    if ($("headerUser")) {
        $("headerUser").textContent =
            profile.full_name || currentUser.email;
    }

    if ($("welcomeName")) {
        $("welcomeName").textContent =
            profile.full_name || "User";
    }

    if ($("welcomeInfo")) {
        $("welcomeInfo").textContent =
            `${profile.role || "student"}${program ? " • " + program.name : ""}`;
    }

    if ($("profileName")) {
        $("profileName").textContent =
            profile.full_name || "Not provided";
    }

    if ($("profileEmail")) {
        $("profileEmail").textContent = currentUser.email || "";
    }

    if ($("profileRole")) {
        $("profileRole").textContent =
            profile.role || "student";
    }

    if ($("profileProgram")) {
        $("profileProgram").textContent =
            program?.name || "Not assigned";
    }

    if ($("profileAvatar")) {
        $("profileAvatar").textContent =
            (profile.full_name || currentUser.email || "U")
                .trim()
                .charAt(0)
                .toUpperCase();
    }

    setVisible($("adminNav"), isAdmin());
    setVisible($("adminPanel"), isAdmin());
    setVisible($("repPanel"), canPost());

    if ($("adminNotice")) {
        $("adminNotice").textContent = isAdmin()
            ? "Administrator access is enabled."
            : "Administrator access is required.";

        setVisible($("adminNotice"), !isAdmin());
    }
}

/* =========================================================
   LOAD CLASSROOMS
========================================================= */

async function loadClassrooms() {
    const { data, error } = await db
        .from("classrooms")
        .select("id, name, building, capacity, image_url")
        .order("name");

    if (error) throw error;

    classrooms = data || [];
}

/* =========================================================
   LOAD LECTURE POSTS
========================================================= */

async function loadPosts() {
    let query = db
        .from("lecture_posts")
        .select(`
            id,
            program_id,
            classroom_id,
            posted_by,
            title,
            details,
            start_time,
            duration_minutes,
            cancelled,
            lecture_end_time,
            classrooms (
                name,
                building,
                image_url
            ),
            programs (
                name
            )
        `)
        .order("start_time", { ascending: false });

    if (
        normalizedRole() === "student" &&
        profile.program_id
    ) {
        query = query.eq("program_id", profile.program_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    posts = data || [];
}

/* =========================================================
   LECTURE STATUS AND AVAILABILITY
========================================================= */

function getPostEndTime(post) {
    if (post.lecture_end_time) {
        return new Date(post.lecture_end_time);
    }

    return new Date(
        new Date(post.start_time).getTime() +
        Number(post.duration_minutes) * 60000
    );
}

function getPostStatus(post) {
    if (post.cancelled) return "cancelled";

    const start = new Date(post.start_time).getTime();
    const end = getPostEndTime(post).getTime();
    const now = Date.now();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return "unknown";
    }

    if (now < start) return "upcoming";
    if (now < end) return "active";

    return "past";
}

function roomIsOccupied(roomId) {
    return posts.some(post =>
        String(post.classroom_id) === String(roomId) &&
        getPostStatus(post) === "active"
    );
}

function getRoomStatus(roomId) {
    return roomIsOccupied(roomId) ? "Occupied" : "Available";
}

function formatDateTime(value) {
    if (!value) return "Not available";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "Not available"
        : date.toLocaleString();
}

function formatDuration(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return "Not specified";
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!hours) return `${remainder} min`;
    if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainder} min`;
}

/* =========================================================
   AVAILABLE CLASSROOM DROPDOWN
========================================================= */

function renderPostRoomDropdown() {
    const select = $("postRoom");
    if (!select) return;

    const oldValue = select.value;

    const availableRooms = classrooms.filter(
        room => !roomIsOccupied(room.id)
    );

    select.replaceChildren(
        new Option(
            availableRooms.length
                ? "Select an available classroom"
                : "No classrooms currently available",
            ""
        )
    );

    availableRooms.forEach(room => {
        select.add(
            new Option(
                `${room.name} — ${room.building || "Building not specified"}`,
                room.id
            )
        );
    });

    if (
        oldValue &&
        availableRooms.some(
            room => String(room.id) === oldValue
        )
    ) {
        select.value = oldValue;
    }
}

/* =========================================================
   RENDER CLASSROOM DIRECTORY
========================================================= */

function renderRooms() {
    const container = $("classroomList");

    renderPostRoomDropdown();

    if (!container) return;

    const search = ($("roomSearch")?.value || "").toLowerCase();
    const filter = $("roomStatusFilter")?.value || "all";

    const filteredRooms = classrooms.filter(room => {
        const text =
            `${room.name} ${room.building || ""}`.toLowerCase();

        const matchesSearch = text.includes(search);
        const status = getRoomStatus(room.id).toLowerCase();

        return matchesSearch &&
            (filter === "all" || status === filter.toLowerCase());
    });

    if (!filteredRooms.length) {
        container.innerHTML =
            `<p class="empty-state">No classrooms match your search.</p>`;
        return;
    }

    container.innerHTML = filteredRooms.map(room => {
        const occupied = roomIsOccupied(room.id);

        const image = room.image_url
            ? `<img src="${escapeHTML(room.image_url)}"
                    alt="${escapeHTML(room.name)}"
                    loading="lazy">`
            : "";

        return `
            <article class="classroom-card">
                ${image}
                <div class="classroom-card-content">
                    <h3>${escapeHTML(room.name)}</h3>
                    <p>${escapeHTML(room.building || "Building not specified")}</p>
                    <p>Capacity: ${escapeHTML(room.capacity ?? "Not specified")}</p>
                    <span class="status ${occupied ? "occupied" : "available"}">
                        ${occupied ? "Occupied" : "Available"}
                    </span>
                </div>
            </article>
        `;
    }).join("");
}

/* =========================================================
   RENDER ANNOUNCEMENTS
========================================================= */

function postMatchesSearch(post, search) {
    const text = `${post.title || ""} ${post.details || ""} ${post.classrooms?.name || ""} ${post.programs?.name || ""}`.toLowerCase();
    return text.includes(search);
}

function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTimetableRange() {
    const mode = $("scheduleRange")?.value || "all";
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    if (mode === "today") {
        end.setDate(end.getDate() + 1);
    } else if (mode === "week") {
        const day = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - day);
        end.setTime(start.getTime());
        end.setDate(end.getDate() + 7);
    } else if (mode === "date") {
        const value = $("scheduleDate")?.value;
        if (!value) return { mode, start: null, end: null };
        const [year, month, day] = value.split("-").map(Number);
        const selected = new Date(year, month - 1, day);
        return { mode, start: selected, end: new Date(year, month - 1, day + 1) };
    }
    return { mode, start: mode === "all" ? null : start, end: mode === "all" ? null : end };
}

function renderTimetable() {
    const container = $("timetableList");
    if (!container) return;
    const range = getTimetableRange();
    if (range.mode === "date" && !range.start) {
        container.innerHTML = '<p class="empty-state">Choose a date to view its lectures.</p>';
        return;
    }
    const search = ($("postSearch")?.value || "").toLowerCase();
    const filtered = posts.filter(post => {
        if (!postMatchesSearch(post, search)) return false;
        const start = new Date(post.start_time);
        if (Number.isNaN(start.getTime())) return false;
        if (range.start && start < range.start) return false;
        if (range.end && start >= range.end) return false;
        return true;
    }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    if (!filtered.length) {
        container.innerHTML = '<p class="empty-state">No lectures are scheduled for this date range.</p>';
        return;
    }
    container.innerHTML = filtered.map(post => {
        const status = getPostStatus(post);
        return `<article class="timetable-item ${post.cancelled ? "is-cancelled" : ""}">
            <div class="timetable-time"><strong>${escapeHTML(new Date(post.start_time).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}))}</strong><span>${escapeHTML(new Date(post.start_time).toLocaleDateString([], {day:"numeric", month:"short"}))}</span></div>
            <div class="timetable-main"><h4>${escapeHTML(post.title || "Lecture")}</h4><p>${escapeHTML(post.classrooms?.name || "Unknown classroom")} · ${escapeHTML(post.programs?.name || "Programme not specified")}</p><small>Ends ${escapeHTML(formatDateTime(getPostEndTime(post)))}</small></div>
            <span class="status ${escapeHTML(status)}">${escapeHTML(status.toUpperCase())}</span>
        </article>`;
    }).join("");
}

function renderPosts() {
    const container = $("postsList");
    if (!container) return;
    const search = ($("postSearch")?.value || "").toLowerCase();
    const filter = $("postStatusFilter")?.value || "all";
    const filteredPosts = posts.filter(post => {
        const status = getPostStatus(post);
        const endMs = getPostEndTime(post).getTime();
        if (Number.isFinite(endMs) && endMs <= Date.now()) return false;
        return postMatchesSearch(post, search) && (filter === "all" || status === filter);
    });
    if (!filteredPosts.length) {
        container.innerHTML = '<p class="empty-state">No announcements found.</p>';
    } else {
        container.innerHTML = filteredPosts.map(post => {
            const status = getPostStatus(post);
            const room = post.classrooms || {};
            const program = post.programs || {};
            const canManage = isAdmin() || post.posted_by === currentUser?.id;
            const editButton = canManage && !post.cancelled && status !== "past"
                ? `<button type="button" class="button button-outline" data-edit-post="${escapeHTML(post.id)}">Edit lecture</button>` : "";
            const cancelButton = canManage && !post.cancelled && status !== "past"
                ? `<button type="button" class="button button-danger" data-cancel-post="${escapeHTML(post.id)}">Cancel lecture</button>` : "";
            return `<article class="announcement-card"><div class="announcement-header"><h3>${escapeHTML(post.title || "Lecture announcement")}</h3><span class="status ${escapeHTML(status)}">${escapeHTML(status.toUpperCase())}</span></div>
                <p>${escapeHTML(post.details || "No additional details.")}</p><p><strong>Classroom:</strong> ${escapeHTML(room.name || "Unknown")}</p><p><strong>Building:</strong> ${escapeHTML(room.building || "Not specified")}</p><p><strong>Programme:</strong> ${escapeHTML(program.name || "Not specified")}</p><p><strong>Starts:</strong> ${escapeHTML(formatDateTime(post.start_time))}</p><p><strong>Duration:</strong> ${escapeHTML(formatDuration(post.duration_minutes))}</p><p><strong>Expected end:</strong> ${escapeHTML(formatDateTime(getPostEndTime(post)))}</p><div class="lecture-actions">${editButton}${cancelButton}</div></article>`;
        }).join("");
    }
    container.querySelectorAll("[data-cancel-post]").forEach(button => button.addEventListener("click", () => cancelPost(button.dataset.cancelPost)));
    container.querySelectorAll("[data-edit-post]").forEach(button => button.addEventListener("click", () => openEditLecture(button.dataset.editPost)));
    renderTimetable();
}

function toLocalDateTimeInput(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function openEditLecture(postId) {
    const post = posts.find(item => String(item.id) === String(postId));
    if (!post) return notify("Lecture not found. Refresh and try again.", "error");
    if (!isAdmin() && post.posted_by !== currentUser?.id) return notify("You cannot edit another user's lecture.", "error");
    if (post.cancelled || getPostStatus(post) === "past") return notify("Past or cancelled lectures cannot be edited.", "error");
    $("editPostId").value = post.id;
    $("editPostTitle").value = post.title || "";
    $("editPostDetails").value = post.details || "";
    $("editPostStart").value = toLocalDateTimeInput(post.start_time);
    $("editPostDuration").value = Number(post.duration_minutes || 60) / 60;
    const roomSelect = $("editPostRoom");
    roomSelect.replaceChildren(...classrooms.map(room => new Option(`${room.name} (${room.building || "Building not specified"})`, room.id)));
    roomSelect.value = String(post.classroom_id);
    $("editLectureModal").hidden = false;
    document.body.classList.add("modal-open");
}

function closeEditLecture() {
    if ($("editLectureModal")) $("editLectureModal").hidden = true;
    document.body.classList.remove("modal-open");
}

$("closeEditLecture")?.addEventListener("click", closeEditLecture);
$("editLectureModal")?.addEventListener("click", event => { if (event.target === $("editLectureModal")) closeEditLecture(); });
$("editLectureForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const postId = $("editPostId").value;
    const post = posts.find(item => String(item.id) === String(postId));
    if (!post || (!isAdmin() && post.posted_by !== currentUser?.id)) return notify("You do not have permission to edit this lecture.", "error");
    const title = $("editPostTitle").value.trim();
    const details = $("editPostDetails").value.trim();
    const roomId = $("editPostRoom").value;
    const start = new Date($("editPostStart").value);
    const hours = Number($("editPostDuration").value);
    const minutes = Math.round(hours * 60);
    if (!title || !roomId || !Number.isFinite(start.getTime()) || !Number.isFinite(hours) || hours < 0.25 || hours > 24) return notify("Check the title, classroom, date, time and duration.", "error");
    if (start.getTime() <= Date.now()) return notify("Choose a future start time for the lecture.", "error");
    const startMs = start.getTime(), endMs = startMs + minutes * 60000;
    const conflict = posts.some(other => {
        if (String(other.id) === String(postId) || other.cancelled || String(other.classroom_id) !== String(roomId)) return false;
        const otherStart = new Date(other.start_time).getTime(), otherEnd = getPostEndTime(other).getTime();
        return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && startMs < otherEnd && endMs > otherStart;
    });
    if (conflict) return notify("This classroom already has a lecture overlapping that time. Choose another room or time.", "error");
    const button = $("saveLectureChanges");
    button.disabled = true;
    try {
        const { error } = await db.from("lecture_posts").update({
            title, details, classroom_id: roomId, start_time: start.toISOString(), duration_minutes: minutes,
            lecture_end_time: new Date(endMs).toISOString()
        }).eq("id", postId);
        if (error) throw error;
        closeEditLecture();
        notify("Lecture updated successfully.", "success");
        await refreshDashboard();
    } catch (error) {
        notify(friendlyError(error), "error");
        try { await refreshDashboard(); } catch (_) {}
    } finally { button.disabled = false; }
});

function renderNotifications() {
    const container = $("notificationsList");
    const badge = $("notificationBadge");
    if (!container) return;

    const items = posts
        .filter(post => {
            const endMs = getPostEndTime(post).getTime();
            return Number.isFinite(endMs) && endMs > Date.now();
        })
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .slice(0, 12);

    if (badge) {
        badge.textContent = String(items.length);
        badge.hidden = items.length === 0;
    }

    container.innerHTML = items.map(post => {
        const status = getPostStatus(post);
        const title = post.cancelled ? "Lecture cancelled" : status === "active" ? "Lecture in progress" : "Upcoming lecture";
        return `<article class="notification-card">
            <span class="notification-icon" aria-hidden="true">${post.cancelled ? "!" : status === "active" ? "▶" : "◷"}</span>
            <div class="notification-body"><div class="notification-title-row"><h3>${escapeHTML(title)}</h3><span class="status ${escapeHTML(status)}">${escapeHTML(status.toUpperCase())}</span></div>
            <p><strong>${escapeHTML(post.title || "Lecture")}</strong> — ${escapeHTML(post.classrooms?.name || "Classroom not specified")}</p>
            <p class="muted">${escapeHTML(formatDateTime(post.start_time))}${post.cancelled ? " · This lecture has been cancelled." : ""}</p></div>
        </article>`;
    }).join("") || '<p class="empty-state">There are no current or upcoming lecture updates.</p>';
}

/* =========================================================
   RENDER DASHBOARD OVERVIEW
========================================================= */

function renderOverview() {
    if ($("totalRooms")) {
        $("totalRooms").textContent = classrooms.length;
    }

    if ($("availableRooms")) {
        $("availableRooms").textContent =
            classrooms.filter(room => !roomIsOccupied(room.id)).length;
    }

    if ($("totalPosts")) {
        $("totalPosts").textContent =
            posts.filter(post => getPostStatus(post) === "active").length;
    }

    const roomList = $("overviewRoomList");

    if (roomList) {
        roomList.innerHTML = classrooms.slice(0, 5).map(room => {
            const occupied = roomIsOccupied(room.id);

            return `
                <div class="overview-list-item">
                    <span>${escapeHTML(room.name)}</span>
                    <span class="status ${occupied ? "occupied" : "available"}">
                        ${occupied ? "Occupied" : "Available"}
                    </span>
                </div>
            `;
        }).join("") || "<p>No classrooms have been added.</p>";
    }

    const postList = $("overviewPostList");

    if (postList) {
        const activePosts = posts
            .filter(post => getPostStatus(post) === "active")
            .slice(0, 5);

        postList.innerHTML = activePosts.map(post => `
            <div class="overview-list-item">
                <span>${escapeHTML(post.title)}</span>
                <span>${escapeHTML(post.classrooms?.name || "Classroom")}</span>
            </div>
        `).join("") || "<p>There are no lectures in progress.</p>";
    }
}

/* =========================================================
   NAVIGATION AND BACK BUTTONS
========================================================= */
function showPage(pageName, remember = true) {
    if (!pageName) return;
    const pageId = String(pageName).endsWith("Page") ? String(pageName) : `${pageName}Page`;
    const target = $(pageId);
    if (!target || !target.classList.contains("page")) {
        console.warn("Navigation page not found:", pageId);
        return;
    }

    if (remember && currentPageId && currentPageId !== pageId) {
        pageHistory.push(currentPageId);
        if (pageHistory.length > 20) pageHistory.shift();
    }
    currentPageId = pageId;

    document.querySelectorAll("#dashboard .page").forEach(page => {
        page.classList.toggle("active", page.id === pageId);
    });
    document.querySelectorAll(".nav-item[data-page]").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageId);
    });

    // Add a contextual back button to every page except Overview.
    document.querySelectorAll(".page-back").forEach(button => button.remove());
    if (pageId !== "overviewPage") {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "button button-outline button-small page-back";
        back.textContent = "← Back";
        back.setAttribute("aria-label", "Go back to the previous section");
        back.addEventListener("click", goBackPage);
        target.prepend(back);
    }
    if (pageId === "notificationsPage") renderNotifications();
    if (window.matchMedia && window.matchMedia("(max-width: 850px)").matches) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function goBackPage() {
    const previous = pageHistory.pop();
    showPage(previous && $(previous) ? previous : "overviewPage", false);
}
window.showPage = showPage;
window.goBackPage = goBackPage;

document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
});
document.querySelectorAll("[data-go-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.goPage));
});

/* =========================================================
   REFRESH DASHBOARD
========================================================= */

async function refreshDashboard() {
    if (!currentUser || refreshInProgress) return;

    refreshInProgress = true;

    try {
        await loadPrograms();
        await loadProfile();
        await loadClassrooms();
        await loadPosts();

        renderRooms();
        renderPosts();
        renderOverview();
    } catch (error) {
        console.error("Dashboard refresh error:", error);
        notify(friendlyError(error), "error");
        throw error;
    } finally {
        refreshInProgress = false;
    }
}

/* =========================================================
   OPEN DASHBOARD AFTER LOGIN
========================================================= */

async function enterDashboard() {
    if (!currentUser || dashboardLoading) return;

    dashboardLoading = true;

    try {
        await loadPrograms();
        await loadProfile();
        await loadClassrooms();
        await loadPosts();

        showDashboard();

        renderRooms();
        renderPosts();
        renderOverview();

        startRealtimeUpdates();
    } catch (error) {
        console.error("Dashboard loading error:", error);
        notify(friendlyError(error), "error");
    } finally {
        dashboardLoading = false;
    }
}

/* =========================================================
   LOGIN
========================================================= */

$("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("loginEmail")?.value.trim();
    const password = $("loginPassword")?.value;

    if (!email || !password) {
        notify("Enter your email and password.", "error");
        return;
    }

    const button = event.submitter;
    if (button) button.disabled = true;

    try {
        const { data, error } = await db.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        currentUser = data.user || data.session?.user || null;

        if (!currentUser) {
            throw new Error(
                "Login succeeded, but the user session was not returned."
            );
        }

        await enterDashboard();

        if ($("dashboard") && !$("dashboard").hidden) {
            notify("Login successful.", "success");
        }
    } catch (error) {
        console.error("Login error:", error);
        notify(friendlyError(error), "error");
    } finally {
        if (button) button.disabled = false;
    }
});

/* =========================================================
   SIGNUP
========================================================= */

$("signupForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const fullName = $("signupName")?.value.trim();
    const email = $("signupEmail")?.value.trim();
    const password = $("signupPassword")?.value;
    const programId = $("signupProgram")?.value;

    if (!fullName || !email || !password || !programId) {
        notify("Please complete all signup fields.", "error");
        return;
    }

    try {
        const { data, error } = await db.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    program_id: programId
                }
            }
        });

        if (error) throw error;

        if (data.session && data.user) {
            const { error: profileError } = await db
                .from("profiles")
                .update({
                    full_name: fullName,
                    program_id: programId
                })
                .eq("id", data.user.id);

            if (profileError) throw profileError;

            currentUser = data.user;
            await enterDashboard();

            notify("Account created successfully.", "success");
        } else {
            notify(
                "Account created. Confirm your email before signing in.",
                "success"
            );
        }
    } catch (error) {
        console.error("Signup error:", error);
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   FORGOT PASSWORD
========================================================= */

$("forgotPasswordLink")?.addEventListener("click", async event => {
    event.preventDefault();

    const email = $("loginEmail")?.value.trim();

    if (!email) {
        notify(
            "Enter your email in the login email field first.",
            "error"
        );
        return;
    }

    try {
        const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });

        if (error) throw error;

        notify(
            "If an account exists for that email, a password reset link will be sent.",
            "success"
        );
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   RESET PASSWORD
========================================================= */

$("resetPasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const password = $("newPassword")?.value;
    const confirmation = $("confirmPassword")?.value;

    if (!password || password.length < 6) {
        notify(
            "Your password must contain at least 6 characters.",
            "error"
        );
        return;
    }

    if (password !== confirmation) {
        notify("The passwords do not match.", "error");
        return;
    }

    try {
        const { error } = await db.auth.updateUser({ password });

        if (error) throw error;

        notify("Password updated successfully.", "success");

        const { error: signOutError } = await db.auth.signOut();

        if (signOutError) throw signOutError;

        currentUser = null;
        profile = null;
        showAuth();
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   LOGOUT
========================================================= */

$("logoutButton")?.addEventListener("click", async () => {
    try {
        const { error } = await db.auth.signOut();

        if (error) throw error;

        currentUser = null;
        profile = null;
        posts = [];
        classrooms = [];

        await stopRealtimeUpdates();
        showAuth();
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   POST LECTURE
   Select a start date/time; duration is entered in hours.
   Database compatibility is preserved using duration_minutes.
========================================================= */

$("postForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUser || !profile) {
        notify("Please sign in before posting a lecture.", "error");
        return;
    }

    if (!canPost()) {
        notify("You do not have permission to post lectures.", "error");
        return;
    }

    const title = $("postTitle")?.value.trim();
    const details = $("postDetails")?.value.trim() || "";
    const roomId = $("postRoom")?.value;
    const startValue = $("postStart")?.value;
    const durationHours = Number($("postDuration")?.value);
    const durationMinutes = durationHours * 60;

    if (!title || !roomId || !startValue || !Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 24) {
        notify("Enter a title, select a classroom, choose the lecture date and time, and enter a duration from 0.25 to 24 hours.", "error");
        return;
    }

    // datetime-local values are interpreted in the browser's local timezone.
    const start = new Date(startValue);
    if (Number.isNaN(start.getTime())) {
        notify("Please choose a valid lecture date and time.", "error");
        return;
    }
    const startMs = start.getTime();
    const endMs = startMs + durationMinutes * 60000;
    if (startMs <= Date.now()) {
        notify("Lectures must be scheduled to start in the future. Choose a later date and time.", "error");
        return;
    }
    if (endMs <= startMs) {
        notify("The lecture end time must be after its start time.", "error");
        return;
    }

    if (!classrooms.some(room => String(room.id) === String(roomId))) {
        notify("Please select a valid classroom.", "error");
        return;
    }

    // Validate the room against the selected lecture time, not only its status right now.
    const overlap = posts.some(post => {
        if (
            post.cancelled ||
            String(post.classroom_id) !== String(roomId)
        ) {
            return false;
        }

        const existingStart = new Date(post.start_time).getTime();
        const existingEnd = getPostEndTime(post).getTime();

        if (
            !Number.isFinite(existingStart) ||
            !Number.isFinite(existingEnd)
        ) {
            return false;
        }

        return startMs < existingEnd && endMs > existingStart;
    });

    if (overlap) {
        notify(
            "This classroom has a conflicting lecture. Choose another classroom.",
            "error"
        );
        await refreshDashboard();
        return;
    }

    const button = event.submitter;
    if (button) button.disabled = true;

    try {
        const { error } = await db
            .from("lecture_posts")
            .insert({
                program_id: profile.program_id,
                classroom_id: roomId,
                posted_by: currentUser.id,
                title,
                details,
                start_time: start.toISOString(),
                duration_minutes: durationMinutes,
                cancelled: false
            });

        if (error) throw error;

        $("postForm").reset();

        notify("Lecture published successfully.", "success");
        await refreshDashboard();
    } catch (error) {
        notify(friendlyError(error), "error");

        try {
            await refreshDashboard();
        } catch (_) {
            // The refresh function already reports errors.
        }
    } finally {
        if (button) button.disabled = false;
    }
});

/* =========================================================
   CANCEL LECTURE
========================================================= */

async function cancelPost(postId) {
    const post = posts.find(
        item => String(item.id) === String(postId)
    );

    if (!post) {
        notify("Lecture announcement not found.", "error");
        return;
    }

    if (!isAdmin() && post.posted_by !== currentUser?.id) {
        notify("You cannot cancel another user's lecture.", "error");
        return;
    }

    if (!confirm("Are you sure you want to cancel this lecture?")) {
        return;
    }

    try {
        const { error } = await db
            .from("lecture_posts")
            .update({ cancelled: true })
            .eq("id", postId);

        if (error) throw error;

        notify("Lecture cancelled.", "success");
        await refreshDashboard();
    } catch (error) {
        notify(friendlyError(error), "error");
    }
}

/* =========================================================
   ADMIN: ADD CLASSROOM
========================================================= */

$("classroomForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) {
        notify("Administrator access is required.", "error");
        return;
    }

    const name = $("roomName")?.value.trim();
    const building = $("roomBuilding")?.value.trim();
    const capacity = Number($("roomCapacity")?.value);
    const imageFile = $("roomImage")?.files?.[0];

    if (
        !name ||
        !building ||
        !Number.isFinite(capacity) ||
        capacity <= 0
    ) {
        notify(
            "Enter a classroom name, building, and valid capacity.",
            "error"
        );
        return;
    }

    try {
        let imageUrl = null;

        if (imageFile) {
            if (imageFile.size > 5 * 1024 * 1024) {
                notify("The classroom photo must be smaller than 5 MB.", "error");
                return;
            }

            const safeName = imageFile.name.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );

            const filePath = `${Date.now()}-${safeName}`;

            const { error: uploadError } = await db.storage
                .from("classroom-images")
                .upload(filePath, imageFile);

            if (uploadError) throw uploadError;

            const { data } = db.storage
                .from("classroom-images")
                .getPublicUrl(filePath);

            imageUrl = data.publicUrl;
        }

        const { error } = await db
            .from("classrooms")
            .insert({
                name,
                building,
                capacity,
                image_url: imageUrl
            });

        if (error) throw error;

        $("classroomForm").reset();

        notify("Classroom added successfully.", "success");
        await refreshDashboard();
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   ADMIN: ASSIGN ROLE
========================================================= */

$("roleForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) {
        notify("Administrator access is required.", "error");
        return;
    }

    const userId = $("targetUserId")?.value.trim();
    const role = $("targetRole")?.value;
    const programId = $("targetProgram")?.value || null;

    const validRoles = [
        "student",
        "class_rep",
        "lecturer",
        "admin"
    ];

    if (!userId || !validRoles.includes(role)) {
        notify("Enter a valid user ID and role.", "error");
        return;
    }

    try {
        const { data, error } = await db
            .from("profiles")
            .update({
                role,
                program_id: programId
            })
            .eq("id", userId)
            .select("id");

        if (error) throw error;

        if (!data?.length) {
            notify(
                "No profile was updated. Check the user ID and permissions.",
                "error"
            );
            return;
        }

        $("roleForm").reset();
        notify("User role and programme updated.", "success");
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   SEARCH AND FILTERS
========================================================= */

$("roomSearch")?.addEventListener("input", renderRooms);
$("roomStatusFilter")?.addEventListener("change", renderRooms);
$("postSearch")?.addEventListener("input", renderPosts);
$("postStatusFilter")?.addEventListener("change", renderPosts);
$("scheduleRange")?.addEventListener("change", () => { const date = $("scheduleDate"); if (date) date.disabled = $("scheduleRange").value !== "date"; renderTimetable(); });
$("scheduleDate")?.addEventListener("change", renderTimetable);

$("refreshButton")?.addEventListener("click", async () => {
    try {
        await refreshDashboard();
        notify("Dashboard refreshed.", "success");
    } catch (_) {
        // The refresh function already reports the error.
    }
});

/* =========================================================
   HIDE MANUAL START-TIME FIELD
========================================================= */

function hideManualStartTime() {
    // Retain the original startup call, but keep the scheduling field visible.
    const input = $("postStart");
    if (input) {
        input.hidden = false;
        input.style.removeProperty("display");
        input.required = true;
    }
}

/* =========================================================
   SUPABASE REALTIME
========================================================= */

function startRealtimeUpdates() {
    if (realtimeChannel) return;

    realtimeChannel = db
        .channel("classroom-live-updates")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "lecture_posts"
            },
            scheduleLiveRefresh
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "classrooms"
            },
            scheduleLiveRefresh
        )
        .subscribe(status => {
            console.log("Classroom Realtime status:", status);

            if (
                status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT"
            ) {
                console.error(
                    "Realtime connection issue. Check Supabase Realtime settings."
                );
            }
        });
}

function scheduleLiveRefresh(payload) {
    const now = Date.now();
    if (payload && now - lastRealtimeNoticeAt > 8000) {
        lastRealtimeNoticeAt = now;
        const row = payload.new || payload.old || {};
        const title = row.title ? `Lecture update: ${row.title}` : "Campus information has been updated";
        if (localStorage.getItem("mukuba-browser-notifications") === "enabled" && "Notification" in window && Notification.permission === "granted") {
            try { new Notification("Mukuba University", { body: title }); } catch (_) {}
        }
    }
    if (refreshTimer) {
        window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(async () => {
        refreshTimer = null;

        try {
            await refreshDashboard();
        } catch (_) {
            // The refresh function already reports the error.
        }
    }, 500);
}

async function stopRealtimeUpdates() {
    if (!realtimeChannel) return;

    const oldChannel = realtimeChannel;
    realtimeChannel = null;

    try {
        await db.removeChannel(oldChannel);
    } catch (error) {
        console.error("Could not close Realtime channel:", error);
    }
}

/* Update room availability when a lecture ends. */
clockTimer = window.setInterval(() => {
    if (!currentUser || refreshInProgress) return;

    renderRooms();
    renderPosts();
    renderOverview();
}, 15000);

/* =========================================================
   AUTHENTICATION STATE CHANGES
========================================================= */

db.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;

    if (event === "PASSWORD_RECOVERY") {
        showResetPassword();
        return;
    }

    if (event === "SIGNED_OUT") {
        currentUser = null;
        profile = null;
        posts = [];
        classrooms = [];

        stopRealtimeUpdates();
        showAuth();
        return;
    }

    if (event === "INITIAL_SESSION" && authReady && currentUser) {
        window.setTimeout(() => {
            if (currentUser) enterDashboard();
        }, 0);
    }
});

/* =========================================================
   START APPLICATION
========================================================= */

async function startApp() {
    updateYear();
    hideManualStartTime();

    try {
        const { data, error } = await db.auth.getSession();

        if (error) throw error;

        currentUser = data.session?.user || null;

        if (!currentUser) {
            await loadPrograms();
            showAuth();
            authReady = true;
            return;
        }

        await enterDashboard();
        authReady = true;
    } catch (error) {
        console.error("Application startup error:", error);
        showAuth();
        notify(friendlyError(error), "error");
        authReady = true;
    }
}

function showAuthView(view) {
    const signup = view === "signup";
    setVisible($("loginForm"), !signup);
    setVisible($("signupForm"), signup);
    setVisible($("authHeading"), !signup);
    setVisible($("signupHeading"), signup);
    setVisible($("goToSignup"), !signup);
    setVisible($("goToLogin"), signup);
}

$("goToSignup")?.addEventListener("click", event => {
    event.preventDefault();
    showAuthView("signup");
});
$("goToLogin")?.addEventListener("click", event => {
    event.preventDefault();
    showAuthView("login");
});

$("toggleLoginPassword")?.addEventListener("click", function () {
    const input = $("loginPassword");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
    this.setAttribute("aria-pressed", String(show));
});
$("toggleSignupPassword")?.addEventListener("click", function () {
    const input = $("signupPassword");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
    this.setAttribute("aria-pressed", String(show));
});

/* =========================================================
   THEME AND USER PREFERENCES
========================================================= */
function applyTheme(theme, announce = false) {
    const selected = theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = selected;
    localStorage.setItem("mukuba-theme", selected);
    const toggle = $("darkModeToggle");
    if (toggle) toggle.checked = selected === "dark";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = selected === "dark" ? "#101827" : "#123b70";
    if (announce) notify(`${selected === "dark" ? "Dark" : "Light"} mode enabled.`, "success");
}

function loadPreferences() {
    applyTheme(localStorage.getItem("mukuba-theme") || "light");
    const enabled = localStorage.getItem("mukuba-browser-notifications") === "enabled";
    const button = $("enableBrowserNotifications");
    if (button) button.textContent = enabled ? "Notifications enabled" : "Enable notifications";
}

$("darkModeToggle")?.addEventListener("change", event => {
    applyTheme(event.target.checked ? "dark" : "light", true);
});

$("enableBrowserNotifications")?.addEventListener("click", async () => {
    if (!("Notification" in window)) {
        notify("This browser does not support desktop notifications. You can still view updates on the Notifications page.", "error");
        return;
    }
    try {
        const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (permission === "granted") {
            localStorage.setItem("mukuba-browser-notifications", "enabled");
            $("enableBrowserNotifications").textContent = "Notifications enabled";
            notify("Browser notifications are enabled on this device.", "success");
        } else {
            localStorage.setItem("mukuba-browser-notifications", "disabled");
            notify("Browser notifications were not allowed. You can change this in your browser settings.", "info");
        }
    } catch (error) {
        notify("Could not enable browser notifications in this browser.", "error");
    }
});

$("resetPreferences")?.addEventListener("click", () => {
    localStorage.removeItem("mukuba-theme");
    localStorage.removeItem("mukuba-browser-notifications");
    loadPreferences();
    notify("Display preferences have been reset.", "success");
});

loadPreferences();
startApp();
