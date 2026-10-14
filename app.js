
/* =========================================================
   MUKUBA UNIVERSITY CLASSROOM MANAGEMENT SYSTEM
   Complete app.js
   HTML + CSS + JavaScript + Supabase
========================================================= */

const SUPABASE_URL = "https://mbieizajeifupzuokefx.supabase.co";
const SUPABASE_KEY = "sb_publishable_0ns5_TamqKpwft8NV1rkKw_MebMI8d0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================================================
   GLOBAL VARIABLES
========================================================= */

let currentUser = null;
let profile = null;
let programs = [];
let classrooms = [];
let posts = [];
let refreshInProgress = false;
let refreshTimer = null;

const $ = id => document.getElementById(id);

const isAdmin = () => profile?.role === "admin";

const canPost = () =>
    ["admin", "class_rep", "lecturer"].includes(profile?.role);

const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);

function notify(message, type = "info") {
    const toastRegion = $("toastRegion");
    const messageBox = $("message");

    if (toastRegion) {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toastRegion.appendChild(toast);

        window.setTimeout(() => toast.remove(), 5000);
    } else if (messageBox) {
        messageBox.textContent = message;
        messageBox.className = `message ${type}`;
        messageBox.hidden = false;

        window.setTimeout(() => {
            messageBox.hidden = true;
        }, 5000);
    } else {
        alert(message);
    }
}

function friendlyError(error) {
    if (!error) return "Something went wrong. Please try again.";

    if (
        error.code === "23P01" ||
        String(error.message || "").includes(
            "no_overlapping_classroom_lectures"
        )
    ) {
        return "This classroom has a conflicting lecture. Please select another available classroom.";
    }

    if (error.code === "23505") {
        return "This record already exists.";
    }

    if (error.code === "42501") {
        return "You do not have permission to perform this action.";
    }

    if (error.message?.toLowerCase().includes("invalid login")) {
        return "Incorrect email or password.";
    }

    if (error.message?.toLowerCase().includes("email not confirmed")) {
        return "Please confirm your email address before signing in.";
    }

    if (
        error.message?.toLowerCase().includes("row-level security") ||
        error.message?.toLowerCase().includes("permission denied")
    ) {
        return "Permission denied. Please check your Supabase access policies.";
    }

    return error.message || "An unexpected error occurred.";
}

function setVisible(element, visible) {
    if (element) element.hidden = !visible;
}

/* =========================================================
   AUTHENTICATION SCREENS
========================================================= */

function showAuth() {
    setVisible($("authSection"), true);
    setVisible($("resetPasswordSection"), false);
    setVisible($("dashboard"), false);
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

    showPage("overview");
    refreshDashboard();
}

function updateYear() {
    if ($("currentYear")) {
        $("currentYear").textContent = new Date().getFullYear();
    }
}

/* =========================================================
   LOAD PROGRAMS
========================================================= */

async function loadPrograms() {
    const { data, error } = await db
        .from("programs")
        .select("id, name")
        .order("name");

    if (error) throw error;

    programs = data || [];

    const signupProgram = $("signupProgram");
    const targetProgram = $("targetProgram");

    [signupProgram, targetProgram].forEach(select => {
        if (!select) return;

        const previousValue = select.value;

        select.replaceChildren(
            new Option("Select a programme", "")
        );

        programs.forEach(program => {
            select.add(
                new Option(program.name, program.id)
            );
        });

        if (
            previousValue &&
            programs.some(p => String(p.id) === previousValue)
        ) {
            select.value = previousValue;
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

    profile = data;

    if (!profile) {
        throw new Error(
            "Your user profile could not be found. Please contact the system administrator."
        );
    }

    const program = programs.find(
        p => String(p.id) === String(profile.program_id)
    );

    if ($("headerUser")) {
        $("headerUser").textContent = profile.full_name || currentUser.email;
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
        $("profileName").textContent = profile.full_name || "Not provided";
    }

    if ($("profileEmail")) {
        $("profileEmail").textContent = currentUser.email || "";
    }

    if ($("profileRole")) {
        $("profileRole").textContent = profile.role || "student";
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
            : "";
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
   LOAD LECTURE ANNOUNCEMENTS
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

    /*
       Students see announcements for their own programme.
       Staff and class representatives can see all programmes.
    */

    if (
        profile?.role === "student" &&
        profile.program_id
    ) {
        query = query.eq("program_id", profile.program_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    posts = data || [];
}

/* =========================================================
   LECTURE STATUS AND CLASSROOM AVAILABILITY
========================================================= */

function getPostStatus(post) {
    if (post.cancelled) return "cancelled";

    const startTime = new Date(post.start_time).getTime();

    const endTime = post.lecture_end_time
        ? new Date(post.lecture_end_time).getTime()
        : startTime + Number(post.duration_minutes) * 60000;

    const now = Date.now();

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
        return "unknown";
    }

    if (now < startTime) return "upcoming";
    if (now < endTime) return "active";

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

function getPostEndTime(post) {
    if (post.lecture_end_time) {
        return new Date(post.lecture_end_time);
    }

    return new Date(
        new Date(post.start_time).getTime() +
        Number(post.duration_minutes) * 60000
    );
}

function formatDateTime(value) {
    if (!value) return "Not available";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Not available";
    }

    return date.toLocaleString();
}

/* =========================================================
   CLASSROOM DROPDOWN
   Only currently available classrooms can be selected.
========================================================= */

function renderPostRoomDropdown() {
    const select = $("postRoom");
    if (!select) return;

    const previousValue = select.value;

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
        previousValue &&
        availableRooms.some(
            room => String(room.id) === previousValue
        )
    ) {
        select.value = previousValue;
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
    const statusFilter = $("roomStatusFilter")?.value || "all";

    const filteredRooms = classrooms.filter(room => {
        const text =
            `${room.name} ${room.building || ""}`.toLowerCase();

        const matchesSearch = text.includes(search);

        const status = getRoomStatus(room.id).toLowerCase();

        const matchesStatus =
            statusFilter === "all" ||
            status === statusFilter.toLowerCase();

        return matchesSearch && matchesStatus;
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

function renderPosts() {
    const container = $("postsList");
    if (!container) return;

    const search = ($("postSearch")?.value || "").toLowerCase();
    const statusFilter = $("postStatusFilter")?.value || "all";

    const filteredPosts = posts.filter(post => {
        const roomName = post.classrooms?.name || "";
        const programName = post.programs?.name || "";

        const text = `
            ${post.title || ""}
            ${post.details || ""}
            ${roomName}
            ${programName}
        `.toLowerCase();

        const status = getPostStatus(post);

        const matchesSearch = text.includes(search);

        const matchesStatus =
            statusFilter === "all" ||
            status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    if (!filteredPosts.length) {
        container.innerHTML =
            `<p class="empty-state">No announcements found.</p>`;
        return;
    }

    container.innerHTML = filteredPosts.map(post => {
        const status = getPostStatus(post);
        const room = post.classrooms || {};
        const program = post.programs || {};

        const canCancel =
            isAdmin() ||
            post.posted_by === currentUser?.id;

        const cancelButton =
            canCancel && !post.cancelled && status !== "past"
                ? `<button type="button"
                           class="cancel-post-button"
                           data-cancel-post="${escapeHTML(post.id)}">
                       Cancel lecture
                   </button>`
                : "";

        return `
            <article class="announcement-card">
                <div class="announcement-header">
                    <h3>${escapeHTML(post.title || "Lecture announcement")}</h3>
                    <span class="status ${escapeHTML(status)}">
                        ${escapeHTML(status.toUpperCase())}
                    </span>
                </div>

                <p>${escapeHTML(post.details || "No additional details.")}</p>

                <p><strong>Classroom:</strong>
                    ${escapeHTML(room.name || "Unknown classroom")}
                </p>

                <p><strong>Building:</strong>
                    ${escapeHTML(room.building || "Not specified")}
                </p>

                <p><strong>Programme:</strong>
                    ${escapeHTML(program.name || "Not specified")}
                </p>

                <p><strong>Started:</strong>
                    ${escapeHTML(formatDateTime(post.start_time))}
                </p>

                <p><strong>Duration:</strong>
                    ${escapeHTML(post.duration_minutes)} minutes
                </p>

                <p><strong>Expected end:</strong>
                    ${escapeHTML(formatDateTime(getPostEndTime(post)))}
                </p>

                ${cancelButton}
            </article>
        `;
    }).join("");

    container.querySelectorAll("[data-cancel-post]").forEach(button => {
        button.addEventListener("click", () => {
            cancelPost(button.dataset.cancelPost);
        });
    });
}

/* =========================================================
   OVERVIEW DASHBOARD
========================================================= */

function renderOverview() {
    if ($("totalRooms")) {
        $("totalRooms").textContent = classrooms.length;
    }

    const availableCount = classrooms.filter(
        room => !roomIsOccupied(room.id)
    ).length;

    if ($("availableRooms")) {
        $("availableRooms").textContent = availableCount;
    }

    if ($("totalPosts")) {
        $("totalPosts").textContent = posts.filter(
            post => !post.cancelled && getPostStatus(post) === "active"
        ).length;
    }

    const roomList = $("overviewRoomList");

    if (roomList) {
        const recentRooms = classrooms.slice(0, 5);

        roomList.innerHTML = recentRooms.length
            ? recentRooms.map(room => {
                const occupied = roomIsOccupied(room.id);

                return `
                    <div class="overview-list-item">
                        <span>${escapeHTML(room.name)}</span>
                        <span class="status ${occupied ? "occupied" : "available"}">
                            ${occupied ? "Occupied" : "Available"}
                        </span>
                    </div>
                `;
            }).join("")
            : `<p>No classrooms have been added.</p>`;
    }

    const postList = $("overviewPostList");

    if (postList) {
        const activePosts = posts
            .filter(post => getPostStatus(post) === "active")
            .slice(0, 5);

        postList.innerHTML = activePosts.length
            ? activePosts.map(post => `
                <div class="overview-list-item">
                    <span>${escapeHTML(post.title)}</span>
                    <span>${escapeHTML(post.classrooms?.name || "Classroom")}</span>
                </div>
            `).join("")
            : `<p>There are no lectures in progress.</p>`;
    }
}

/* =========================================================
   NAVIGATION
========================================================= */

function showPage(pageName) {
    document.querySelectorAll(".page-section, .dashboard-page").forEach(page => {
        page.classList.remove("active");
    });

    const target = $(`${pageName}Page`);

    if (target) {
        target.classList.add("active");
    }

    document.querySelectorAll(".nav-item[data-page]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });
}

window.showPage = showPage;

/* =========================================================
   REFRESH DASHBOARD DATA
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
    } finally {
        refreshInProgress = false;
    }
}

/* =========================================================
   SIGN IN
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
        const { error } = await db.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        notify("Login successful.", "success");
    } catch (error) {
        notify(friendlyError(error), "error");
    } finally {
        if (button) button.disabled = false;
    }
});

/* =========================================================
   SIGN UP
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

        if (data.session) {
            /*
              This assumes your Supabase database has a trigger
              that creates a profiles row after signup.
            */
            const { error: profileError } = await db
                .from("profiles")
                .update({
                    full_name: fullName,
                    program_id: programId
                })
                .eq("id", data.user.id);

            if (profileError) throw profileError;

            notify("Account created successfully.", "success");
        } else {
            notify(
                "Account created. Check your email to confirm your account, then sign in.",
                "success"
            );
        }
    } catch (error) {
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
            "Enter your email address in the login email field first.",
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
    const confirmPassword = $("confirmPassword")?.value;

    if (!password || password.length < 6) {
        notify("Your password must contain at least 6 characters.", "error");
        return;
    }

    if (password !== confirmPassword) {
        notify("The passwords do not match.", "error");
        return;
    }

    try {
        const { error } = await db.auth.updateUser({
            password
        });

        if (error) throw error;

        notify("Password updated successfully. You can now sign in.", "success");

        await db.auth.signOut();
        showAuth();
    } catch (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   LOG OUT
========================================================= */

$("logoutButton")?.addEventListener("click", async () => {
    const { error } = await db.auth.signOut();

    if (error) {
        notify(friendlyError(error), "error");
    }
});

/* =========================================================
   POST A LECTURE
   Start time is set automatically to NOW.
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
    const duration = Number($("postDuration")?.value);

    if (!title || !roomId || !Number.isFinite(duration) || duration <= 0) {
        notify("Enter a title, select an available classroom, and provide a valid duration.", "error");
        return;
    }

    const selectedRoom = classrooms.find(
        room => String(room.id) === String(roomId)
    );

    if (!selectedRoom) {
        notify("Please select a valid classroom.", "error");
        return;
    }

    /*
      Recheck availability immediately before saving.
      The database exclusion constraint is the final safeguard
      against simultaneous conflicting submissions.
    */

    if (roomIsOccupied(roomId)) {
        notify(
            "That classroom is now occupied. Please choose another classroom.",
            "error"
        );

        await refreshDashboard();
        return;
    }

    const start = new Date();
    const startMs = start.getTime();
    const endMs = startMs + duration * 60000;

    const hasOverlap = posts.some(post => {
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

    if (hasOverlap) {
        notify(
            "This classroom has a conflicting lecture. Please choose another classroom.",
            "error"
        );

        await refreshDashboard();
        return;
    }

    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;

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
                duration_minutes: duration,
                cancelled: false
            });

        if (error) throw error;

        $("postForm").reset();

        notify("Lecture published. The classroom is now marked as occupied.", "success");

        await refreshDashboard();
    } catch (error) {
        notify(friendlyError(error), "error");
        await refreshDashboard();
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
});

/* =========================================================
   CANCEL A LECTURE
========================================================= */

async function cancelPost(postId) {
    const post = posts.find(
        item => String(item.id) === String(postId)
    );

    if (!post) {
        notify("Lecture announcement not found.", "error");
        return;
    }

    if (
        !isAdmin() &&
        post.posted_by !== currentUser?.id
    ) {
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

    if (!name || !building || !Number.isFinite(capacity) || capacity <= 0) {
        notify("Enter a classroom name, building, and valid capacity.", "error");
        return;
    }

    let imageUrl = null;

    try {
        if (imageFile) {
            const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const filePath = `${Date.now()}-${safeName}`;

            const { error: uploadError } = await db.storage
                .from("classroom-images")
                .upload(filePath, imageFile, {
                    upsert: false
                });

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
   ADMIN: ASSIGN ROLE AND PROGRAMME
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
                "No profile was updated. Check the user ID and your database permissions.",
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
   SEARCH AND FILTER EVENTS
========================================================= */

$("roomSearch")?.addEventListener("input", renderRooms);

$("roomStatusFilter")?.addEventListener("change", renderRooms);

$("postSearch")?.addEventListener("input", renderPosts);

$("postStatusFilter")?.addEventListener("change", renderPosts);

$("refreshButton")?.addEventListener("click", async () => {
    await refreshDashboard();
    notify("Dashboard refreshed.", "success");
});

/* =========================================================
   HIDE THE OLD MANUAL START-TIME FIELD
   The application records the current time automatically.
========================================================= */

function hideManualStartTime() {
    const startInput = $("postStart");
    const startLabel = document.querySelector('label[for="postStart"]');

    if (startInput) {
        startInput.required = false;
        startInput.hidden = true;
    }

    if (startLabel) {
        startLabel.hidden = true;
    }
}

/* =========================================================
   AUTOMATIC REFRESH
   Recalculates lecture status as time passes.
========================================================= */

async function refreshLiveStatus() {
    if (!currentUser || refreshInProgress) return;

    await refreshDashboard();
}

/*
  The timer makes expired lectures change to "past" and their
  classrooms change back to "Available" without manual refresh.
*/

window.setInterval(() => {
    if (!currentUser || refreshInProgress) return;

    renderRooms();
    renderPosts();
    renderOverview();
}, 15000);

/*
  Supabase Realtime refreshes the page when another user
  inserts, updates, or cancels a lecture.
*/

let realtimeChannel = null;

function startRealtimeUpdates() {
    if (realtimeChannel) {
        db.removeChannel(realtimeChannel);
    }

    realtimeChannel = db
        .channel("classroom-live-updates")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "lecture_posts"
            },
            () => {
                if (refreshTimer) {
                    window.clearTimeout(refreshTimer);
                }

                refreshTimer = window.setTimeout(
                    refreshLiveStatus,
                    500
                );
            }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "classrooms"
            },
            () => {
                if (refreshTimer) {
                    window.clearTimeout(refreshTimer);
                }

                refreshTimer = window.setTimeout(
                    refreshLiveStatus,
                    500
                );
            }
        )
        .subscribe(status => {
            console.log("Classroom Realtime status:", status);
        });
}

/* =========================================================
   APPLICATION STARTUP
========================================================= */

async function startApp() {
    updateYear();
    hideManualStartTime();

    try {
        await loadPrograms();

        const { data, error } = await db.auth.getSession();

        if (error) throw error;

        currentUser = data.session?.user || null;

        if (currentUser) {
            showDashboard();
            startRealtimeUpdates();
        } else {
            showAuth();
        }
    } catch (error) {
        console.error("Application startup error:", error);
        showAuth();
        notify(friendlyError(error), "error");
    }
}

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
        profile = null;
        posts = [];
        classrooms = [];
        showAuth();

        if (realtimeChannel) {
            db.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        return;
    }

    if (
        currentUser &&
        ["SIGNED_IN", "INITIAL_SESSION", "USER_UPDATED"].includes(event)
    ) {
        /*
          Defer database work to avoid doing additional Supabase
          requests directly inside the auth callback.
        */
        window.setTimeout(async () => {
            if (!currentUser) return;

            try {
                await loadPrograms();
                await loadProfile();
                await loadClassrooms();
                await loadPosts();

                renderRooms();
                renderPosts();
                renderOverview();

                setVisible($("authSection"), false);
                setVisible($("resetPasswordSection"), false);
                setVisible($("dashboard"), true);

                startRealtimeUpdates();
            } catch (error) {
                console.error("Authentication update error:", error);
                notify(friendlyError(error), "error");
            }
        }, 0);
    }
});

/* Start the application */
startApp();


