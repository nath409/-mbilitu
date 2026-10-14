
/* =========================================================
   MUKUBA UNIVERSITY CLASSROOM MANAGEMENT SYSTEM
   HTML + JavaScript + Supabase
   ========================================================= */

const SUPABASE_URL = "https://mbieizajeifupzuokefx.supabase.co";
const SUPABASE_KEY = "sb_publishable_0ns5_TamqKpwft8NV1rkKw_MebMI8d0";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let profile = null;
let programs = [];
let rooms = [];
let posts = [];

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function notify(message, type = "info") {
    const messageBox = $("message");

    if (messageBox) {
        messageBox.textContent = message;
        messageBox.classList.remove("hidden");
        messageBox.dataset.type = type;
    }

    const toastRegion = $("toastRegion");

    if (toastRegion) {
        toastRegion.textContent = message;
        toastRegion.dataset.type = type;
    }
}

function friendlyError(error) {
    console.error(error);

    if (
        error?.code === "23P01" ||
        error?.message?.includes("no_overlapping_classroom_lectures")
    ) {
        return "This classroom is already booked during part of that time. Please choose another classroom or a different start time.";
    }

    if (error?.code === "23505") {
        return "This record already exists. Please check your information.";
    }

    if (error?.code === "23503") {
        return "Some selected information is unavailable. Refresh the page and try again.";
    }

    if (error?.code === "42501" || error?.code === "PGRST301") {
        return "You do not have permission to perform this action. Check your account role and Supabase security policies.";
    }

    if (
        error?.message?.includes("Failed to fetch") ||
        error?.message?.includes("NetworkError")
    ) {
        return "Unable to connect to the server. Check your internet connection and try again.";
    }

    if (error?.message?.includes("Invalid login credentials")) {
        return "Incorrect email or password. Please try again.";
    }

    if (error?.message?.includes("Email not confirmed")) {
        return "Please confirm your email address before signing in.";
    }

    return error?.message || "Something went wrong. Please try again.";
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatDate(value) {
    if (!value) return "Not specified";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Not specified";

    return date.toLocaleString();
}

function isCancelled(post) {
    return post.cancelled === true;
}

function getPostEnd(post) {
    if (post.lecture_end_time) {
        return new Date(post.lecture_end_time).getTime();
    }

    return new Date(post.start_time).getTime()
        + Number(post.duration_minutes) * 60000;
}

function getPostStatus(post) {
    if (isCancelled(post)) return "cancelled";

    const now = Date.now();
    const start = new Date(post.start_time).getTime();
    const end = getPostEnd(post);

    if (now < start) return "upcoming";
    if (now >= start && now < end) return "active";

    return "past";
}

function programName(programId) {
    const program = programs.find(
        item => String(item.id) === String(programId)
    );

    return program?.name || "Programme not assigned";
}

function showPage(pageId) {
    const pages = document.querySelectorAll(".page");

    pages.forEach(page => {
        page.classList.toggle("active", page.id === pageId);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageId
        );
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function hide(element) {
    if (element) element.classList.add("hidden");
}

function reveal(element) {
    if (element) element.classList.remove("hidden");
}

function setOptions(selectId, items, placeholder, valueField = "id") {
    const select = $(selectId);
    if (!select) return;

    select.replaceChildren(new Option(placeholder, ""));

    items.forEach(item => {
        select.add(new Option(
            item.name,
            item[valueField]
        ));
    });
}

/* =========================================================
   AUTHENTICATION AND PASSWORD RESET
   ========================================================= */

async function loadPrograms() {
    const { data, error } = await db
        .from("programs")
        .select("id,name")
        .order("name");

    if (error) throw error;

    programs = data || [];

    setOptions(
        "signupProgram",
        programs,
        "Select your programme"
    );

    setOptions(
        "targetProgram",
        programs,
        "No programme"
    );
}

async function loadProfile() {
    const { data, error } = await db
        .from("profiles")
        .select("id,full_name,role,program_id")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        throw new Error(
            "Your user profile was not found. Ask an administrator to check the profiles table."
        );
    }

    profile = data;
}

async function signOut() {
    const { error } = await db.auth.signOut();

    if (error) throw error;

    currentUser = null;
    profile = null;
    rooms = [];
    posts = [];

    hide($("dashboard"));
    hide($("resetPasswordSection"));
    hide($("logoutButton"));
    reveal($("authSection"));

    if ($("headerUser")) {
        $("headerUser").textContent = "Welcome";
    }

    notify("You have logged out successfully.");
}

const loginForm = $("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            notify("Signing in...");

            const email = $("loginEmail").value.trim();
            const password = $("loginPassword").value;

            if (!email || !password) {
                notify("Enter your email address and password.");
                return;
            }

            const { data, error } = await db.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            currentUser = data.user;

            await loadPrograms();
            await showDashboard();

            notify("Welcome back!");
        } catch (error) {
            notify("Login failed: " + friendlyError(error), "error");
        }
    });
}

/* Student registration */

const signupForm = $("signupForm");

if (signupForm) {
    signupForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            notify("Creating your account...");

            const fullName = $("signupName").value.trim();
            const email = $("signupEmail").value.trim();
            const password = $("signupPassword").value;
            const programId = $("signupProgram").value;

            if (!fullName || !email || !password) {
                notify("Please complete all required fields.");
                return;
            }

            if (password.length < 6) {
                notify("Your password must contain at least 6 characters.");
                return;
            }

            const { data, error } = await db.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName
                    }
                }
            });

            if (error) throw error;

            if (!data.session) {
                notify(
                    "Account created. Check your email for the confirmation link. After confirming, sign in and ask an administrator to assign your programme if needed."
                );
                signupForm.reset();
                return;
            }

            currentUser = data.user;

            // Update the programme only if the profile exists
            // and the current account has permission to update it.
            if (programId) {
                const { error: updateError } = await db
                    .from("profiles")
                    .update({ program_id: programId })
                    .eq("id", currentUser.id);

                if (updateError) {
                    console.warn(
                        "Programme assignment needs attention:",
                        updateError
                    );
                }
            }

            await loadPrograms();
            await showDashboard();

            notify("Your account has been created successfully.");
        } catch (error) {
            notify("Registration failed: " + friendlyError(error), "error");
        }
    });
}

/* Forgot password */

const forgotPasswordLink = $("forgotPasswordLink");

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", async event => {
        event.preventDefault();

        const email = $("loginEmail").value.trim();

        if (!email) {
            notify(
                "Enter your email address in the sign-in form first."
            );
            $("loginEmail").focus();
            return;
        }

        try {
            notify("Sending your password-reset link...");

            const redirectTo =
                window.location.origin + window.location.pathname;

            const { error } = await db.auth.resetPasswordForEmail(email, {
                redirectTo
            });

            if (error) throw error;

            notify(
                "If an account exists for that email, a password-reset link will be sent. Check your inbox and spam folder."
            );
        } catch (error) {
            notify(
                "Could not send the reset link: " + friendlyError(error),
                "error"
            );
        }
    });
}

/* Save a new password */

const resetPasswordForm = $("resetPasswordForm");

if (resetPasswordForm) {
    resetPasswordForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            const password = $("newPassword").value;
            const confirmation = $("confirmPassword").value;

            if (password.length < 6) {
                notify("Your new password must contain at least 6 characters.");
                return;
            }

            if (password !== confirmation) {
                notify("The two passwords do not match.");
                return;
            }

            notify("Updating your password...");

            const { error } = await db.auth.updateUser({ password });

            if (error) throw error;

            resetPasswordForm.reset();
            hide($("resetPasswordSection"));
            reveal($("authSection"));

            notify(
                "Your password has been changed. You can now sign in with your new password."
            );

            await db.auth.signOut();
        } catch (error) {
            notify(
                "Password update failed: " + friendlyError(error),
                "error"
            );
        }
    });
}

/* =========================================================
   DASHBOARD AND PROFILE
   ========================================================= */

async function showDashboard() {
    if (!currentUser) return;

    await loadProfile();

    hide($("authSection"));
    hide($("resetPasswordSection"));
    reveal($("dashboard"));
    reveal($("logoutButton"));

    const fullName = profile.full_name || currentUser.email || "User";
    const role = profile.role || "student";
    const programme = programName(profile.program_id);

    if ($("headerUser")) {
        $("headerUser").textContent = fullName;
    }

    if ($("welcomeName")) {
        $("welcomeName").textContent = "Welcome, " + fullName;
    }

    if ($("welcomeInfo")) {
        $("welcomeInfo").textContent =
            "Role: " + role.replaceAll("_", " ")
            + " | Programme: " + programme;
    }

    if ($("profileName")) {
        $("profileName").textContent = fullName;
    }

    if ($("profileEmail")) {
        $("profileEmail").textContent = currentUser.email || "";
    }

    if ($("profileRole")) {
        $("profileRole").textContent = role.replaceAll("_", " ");
    }

    if ($("profileProgram")) {
        $("profileProgram").textContent = programme;
    }

    if ($("profileAvatar")) {
        $("profileAvatar").textContent =
            fullName.charAt(0).toUpperCase();
    }

    const isAdmin = role === "admin";
    const canPost = ["class_rep", "lecturer", "admin"].includes(role);

    if ($("adminPanel")) {
        $("adminPanel").classList.toggle("hidden", !isAdmin);
    }

    if ($("adminNotice")) {
        $("adminNotice").classList.toggle("hidden", isAdmin);
    }

    if ($("adminNav")) {
        $("adminNav").classList.toggle("hidden", !isAdmin);
    }

    if ($("repPanel")) {
        $("repPanel").classList.toggle("hidden", !canPost);
    }

    if ($("repPanel")) {
        const heading = $("repPanel").querySelector("h2");

        if (heading && role === "lecturer") {
            heading.textContent = "Post a lecture announcement";
        }
    }

    await refreshDashboard();
    showPage("overviewPage");
}

/* Dashboard navigation */

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

document.querySelectorAll("[data-go-page]").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.goPage);
    });
});

/* Header logo navigation */

window.showPage = showPage;

/* Logout */

const logoutButton = $("logoutButton");

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        try {
            await signOut();
        } catch (error) {
            notify("Logout failed: " + friendlyError(error), "error");
        }
    });
}

/* =========================================================
   LOAD DATABASE RECORDS
   ========================================================= */

async function loadRooms() {
    const { data, error } = await db
        .from("classrooms")
        .select("*")
        .order("name");

    if (error) throw error;

    rooms = data || [];
}

async function loadPosts() {
    let query = db
        .from("lecture_posts")
        .select(`
            *,
            classrooms(name,building,image_url),
            programs(name)
        `)
        .order("start_time", { ascending: true });

    // Students see announcements for their own programme.
    // Other roles may see broader announcements according to RLS.
    if (profile?.role === "student" && profile.program_id != null) {
        query = query.eq("program_id", profile.program_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    posts = data || [];
}

async function refreshDashboard() {
    await Promise.all([
        loadRooms(),
        loadPosts()
    ]);

    renderRooms();
    renderPosts();
    renderOverview();
}

/* =========================================================
   CLASSROOMS AND AVAILABILITY
   ========================================================= */

function roomIsOccupied(roomId) {
    const now = Date.now();

    return posts.some(post =>
        String(post.classroom_id) === String(roomId)
        && getPostStatus(post) === "active"
    );
}

function renderRooms() {
    const classroomList = $("classroomList");
    const overviewRoomList = $("overviewRoomList");

    if (!classroomList) return;

    const search = ($("roomSearch")?.value || "").trim().toLowerCase();
    const statusFilter = $("roomStatusFilter")?.value || "all";

    const filteredRooms = rooms.filter(room => {
        const text = `${room.name || ""} ${room.building || ""}`
            .toLowerCase();

        const matchesSearch = text.includes(search);
        const occupied = roomIsOccupied(room.id);

        const matchesStatus =
            statusFilter === "all"
            || (statusFilter === "occupied" && occupied)
            || (statusFilter === "available" && !occupied);

        return matchesSearch && matchesStatus;
    });

    classroomList.innerHTML = filteredRooms.map(room => {
        const occupied = roomIsOccupied(room.id);
        const status = occupied ? "Currently occupied" : "Available now";
        const statusClass = occupied ? "occupied" : "empty";

        const image = room.image_url
            ? `<img src="${escapeHTML(room.image_url)}"
                    alt="${escapeHTML(room.name)}"
                    loading="lazy">`
            : "";

        const currentPosts = posts.filter(post =>
            String(post.classroom_id) === String(room.id)
            && getPostStatus(post) === "active"
        );

        const currentDetails = currentPosts.map(post => `
            <p>
                <strong>In progress:</strong>
                ${escapeHTML(post.title)}
            </p>
        `).join("");

        return `
            <article class="room">
                ${image}
                <h3>${escapeHTML(room.name || "Unnamed classroom")}</h3>
                <p><strong>Building:</strong>
                    ${escapeHTML(room.building || "Not specified")}
                </p>
                <p><strong>Capacity:</strong>
                    ${escapeHTML(room.capacity ?? "Not specified")}
                </p>
                <p class="status ${statusClass}">
                    ${status}
                </p>
                ${currentDetails}
            </article>
        `;
    }).join("") || "<p>No classrooms match your search.</p>";

    if (overviewRoomList) {
        overviewRoomList.innerHTML = rooms.slice(0, 5).map(room => {
            const occupied = roomIsOccupied(room.id);

            return `
                <div class="mini-item">
                    <div>
                        <strong>${escapeHTML(room.name)}</strong>
                        <p>${escapeHTML(room.building || "")}</p>
                    </div>
                    <span class="status ${occupied ? "occupied" : "empty"}">
                        ${occupied ? "In use" : "Available"}
                    </span>
                </div>
            `;
        }).join("") || "<p>No classrooms registered.</p>";
    }

    const postRoom = $("postRoom");

    if (postRoom) {
        const selectedValue = postRoom.value;

        postRoom.replaceChildren(
            new Option("Select a classroom", "")
        );

        rooms.forEach(room => {
            postRoom.add(new Option(room.name, room.id));
        });

        if (rooms.some(room => String(room.id) === selectedValue)) {
            postRoom.value = selectedValue;
        }
    }
}

/* Classroom search and status filter */

["roomSearch", "roomStatusFilter"].forEach(id => {
    $(id)?.addEventListener("input", renderRooms);
    $(id)?.addEventListener("change", renderRooms);
});

/* =========================================================
   ANNOUNCEMENTS
   ========================================================= */

function renderPosts() {
    const postsList = $("postsList");
    const overviewPostList = $("overviewPostList");

    if (!postsList) return;

    const search = ($("postSearch")?.value || "").trim().toLowerCase();
    const statusFilter = $("postStatusFilter")?.value || "all";

    const visiblePosts = posts.filter(post => {
        const classroom = post.classrooms?.name || "";
        const details = post.details || "";
        const title = post.title || "";

        const searchableText =
            `${title} ${classroom} ${details}`.toLowerCase();

        const matchesSearch = searchableText.includes(search);
        const status = getPostStatus(post);
        const matchesStatus =
            statusFilter === "all" || status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    postsList.innerHTML = visiblePosts.map(post => {
        const status = getPostStatus(post);
        const isOwner = post.posted_by === currentUser?.id;
        const canCancel =
            !isCancelled(post)
            && (profile?.role === "admin" || isOwner);

        return `
            <article class="post">
                <div class="post-heading">
                    <h3>${escapeHTML(post.title || "Lecture announcement")}</h3>
                    <span class="status ${status}">
                        ${status === "active" ? "In progress" :
                          status === "upcoming" ? "Upcoming" :
                          status === "cancelled" ? "Cancelled" : "Past"}
                    </span>
                </div>

                <p>
                    <strong>Programme:</strong>
                    ${escapeHTML(post.programs?.name || "Not specified")}
                </p>

                <p>
                    <strong>Classroom:</strong>
                    ${escapeHTML(post.classrooms?.name || "Not specified")}
                </p>

                <p>
                    <strong>Building:</strong>
                    ${escapeHTML(post.classrooms?.building || "Not specified")}
                </p>

                <p><strong>Starts:</strong> ${formatDate(post.start_time)}</p>

                <p>
                    <strong>Duration:</strong>
                    ${escapeHTML(post.duration_minutes)} minutes
                </p>

                ${post.details
                    ? `<p>${escapeHTML(post.details)}</p>`
                    : ""}

                ${isCancelled(post)
                    ? '<p class="cancelled">LECTURE CANCELLED</p>'
                    : ""}

                ${canCancel
                    ? `<button class="button button-outline"
                               type="button"
                               data-cancel="${escapeHTML(post.id)}">
                            Cancel lecture
                       </button>`
                    : ""}
            </article>
        `;
    }).join("") || "<p>No announcements match your search.</p>";

    if (overviewPostList) {
        overviewPostList.innerHTML = [...posts]
            .sort((a, b) =>
                new Date(b.start_time) - new Date(a.start_time)
            )
            .slice(0, 5)
            .map(post => `
                <div class="mini-item">
                    <div>
                        <strong>${escapeHTML(post.title || "Lecture")}</strong>
                        <p>${escapeHTML(post.classrooms?.name || "Room not specified")}</p>
                        <p>${formatDate(post.start_time)}</p>
                    </div>
                    <span class="status ${getPostStatus(post)}">
                        ${getPostStatus(post)}
                    </span>
                </div>
            `).join("") || "<p>No announcements yet.</p>";
    }

    postsList.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", async () => {
            await cancelPost(button.dataset.cancel);
        });
    });
}

["postSearch", "postStatusFilter"].forEach(id => {
    $(id)?.addEventListener("input", renderPosts);
    $(id)?.addEventListener("change", renderPosts);
});

/* Dashboard statistics */

function renderOverview() {
    if ($("totalRooms")) {
        $("totalRooms").textContent = rooms.length;
    }

    if ($("availableRooms")) {
        $("availableRooms").textContent =
            rooms.filter(room => !roomIsOccupied(room.id)).length;
    }

    if ($("totalPosts")) {
        $("totalPosts").textContent = posts.length;
    }
}

/* Refresh button */

$("refreshButton")?.addEventListener("click", async () => {
    try {
        notify("Refreshing classroom information...");
        await refreshDashboard();
        notify("Classroom information has been refreshed.");
    } catch (error) {
        notify("Refresh failed: " + friendlyError(error), "error");
    }
});

/* =========================================================
   ADMIN: ADD CLASSROOM
   ========================================================= */

const classroomForm = $("classroomForm");

if (classroomForm) {
    classroomForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            if (profile?.role !== "admin") {
                throw new Error("Only an administrator can add classrooms.");
            }

            const name = $("roomName").value.trim();
            const building = $("roomBuilding").value.trim();
            const capacity = Number($("roomCapacity").value);
            const file = $("roomImage").files?.[0];

            if (!name || !building || !Number.isFinite(capacity) || capacity < 1) {
                throw new Error("Enter a classroom name, building and valid capacity.");
            }

            notify("Saving classroom...");

            let imageUrl = null;

            if (file) {
                if (!file.type.startsWith("image/")) {
                    throw new Error("Please select an image file.");
                }

                if (file.size > 5 * 1024 * 1024) {
                    throw new Error("The image must be smaller than 5 MB.");
                }

                const safeName = file.name.replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

                const path = `${crypto.randomUUID()}-${safeName}`;

                const { error: uploadError } = await db
                    .storage
                    .from("classroom-images")
                    .upload(path, file, { upsert: false });

                if (uploadError) throw uploadError;

                imageUrl = db
                    .storage
                    .from("classroom-images")
                    .getPublicUrl(path).data.publicUrl;
            }

            const { error } = await db.from("classrooms").insert({
                name,
                building,
                capacity,
                image_url: imageUrl
            });

            if (error) throw error;

            classroomForm.reset();
            await refreshDashboard();

            notify("Classroom added successfully.");
        } catch (error) {
            notify("Could not add classroom: " + friendlyError(error), "error");
        }
    });
}

/* =========================================================
   ADMIN: ASSIGN USER ROLE AND PROGRAMME
   ========================================================= */

const roleForm = $("roleForm");

if (roleForm) {
    roleForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            if (profile?.role !== "admin") {
                throw new Error("Only an administrator can change user roles.");
            }

            const userId = $("targetUserId").value.trim();
            const role = $("targetRole").value;
            const programId = $("targetProgram").value;

            if (!userId) {
                throw new Error("Enter the user's profile ID.");
            }

            notify("Updating user account...");

            const { data, error } = await db
                .from("profiles")
                .update({
                    role,
                    program_id: programId || null
                })
                .eq("id", userId)
                .select("id");

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error(
                    "No profile was updated. Check the profile ID and database permissions."
                );
            }

            roleForm.reset();

            notify("User role and programme updated successfully.");
        } catch (error) {
            notify("Could not update user: " + friendlyError(error), "error");
        }
    });
}

/* =========================================================
   CLASS REPRESENTATIVE / LECTURER: POST LECTURE
   ========================================================= */

const postForm = $("postForm");

if (postForm) {
    postForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            if (!currentUser || !profile) {
                throw new Error("Please sign in before posting a lecture.");
            }

            if (!["class_rep", "lecturer", "admin"].includes(profile.role)) {
                throw new Error(
                    "Your account does not have permission to post lectures."
                );
            }

            if (!profile.program_id) {
                throw new Error(
                    "Your account has no assigned programme. Ask an administrator to assign one."
                );
            }

            const title = $("postTitle").value.trim();
            const details = $("postDetails").value.trim();
            const classroomId = $("postRoom").value;
            const startValue = $("postStart").value;
            const duration = Number($("postDuration").value);

            if (!title || !classroomId || !startValue) {
                throw new Error(
                    "Enter the lecture title, classroom and start time."
                );
            }

            if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
                throw new Error("Duration must be between 1 and 1440 minutes.");
            }

            const start = new Date(startValue);

            if (Number.isNaN(start.getTime()) || start <= new Date()) {
                throw new Error("Choose a future lecture start time.");
            }

            const startMs = start.getTime();
            const endMs = startMs + duration * 60000;

            // Friendly early check. The database exclusion constraint
            // remains the final protection against simultaneous bookings.
            const conflict = posts.some(post => {
                if (
                    String(post.classroom_id) !== String(classroomId) ||
                    isCancelled(post)
                ) {
                    return false;
                }

                const otherStart = new Date(post.start_time).getTime();
                const otherEnd = getPostEnd(post);

                return startMs < otherEnd && endMs > otherStart;
            });

            if (conflict) {
                notify(
                    "This classroom is already booked during part of that time. Please choose another classroom or a different start time.",
                    "error"
                );
                return;
            }

            notify("Publishing lecture announcement...");

            const { error } = await db.from("lecture_posts").insert({
                program_id: profile.program_id,
                classroom_id: classroomId,
                posted_by: currentUser.id,
                title,
                details,
                start_time: start.toISOString(),
                duration_minutes: duration,
                cancelled: false
            });

            if (error) {
                if (
                    error.code === "23P01" ||
                    error.message?.includes("no_overlapping_classroom_lectures")
                ) {
                    notify(
                        "This classroom has just been booked for an overlapping time. Please select another classroom or start time.",
                        "error"
                    );

                    await refreshDashboard();
                    return;
                }

                throw error;
            }

            postForm.reset();
            $("postDuration").value = 60;

            await refreshDashboard();

            notify("Lecture announcement published successfully.");
            showPage("announcementsPage");
        } catch (error) {
            notify("Could not publish lecture: " + friendlyError(error), "error");
        }
    });
}

/* =========================================================
   CANCEL A LECTURE
   ========================================================= */

async function cancelPost(postId) {
    const post = posts.find(item => String(item.id) === String(postId));

    if (!post) {
        notify("This announcement could not be found. Refresh and try again.");
        return;
    }

    const isOwner = post.posted_by === currentUser?.id;
    const canCancel =
        profile?.role === "admin" || isOwner;

    if (!canCancel) {
        notify("You are not allowed to cancel this announcement.", "error");
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

        await refreshDashboard();

        notify("Lecture cancelled successfully.");
    } catch (error) {
        notify("Could not cancel lecture: " + friendlyError(error), "error");
    }
}

/* =========================================================
   AUTHENTICATION STARTUP
   ========================================================= */

async function startApp() {
    const year = $("currentYear");

    if (year) {
        year.textContent = new Date().getFullYear();
    }

    try {
        await loadPrograms();

        const { data, error } = await db.auth.getSession();

        if (error) throw error;

        if (data.session?.user) {
            currentUser = data.session.user;
            await showDashboard();
        } else {
            reveal($("authSection"));
            hide($("dashboard"));
            hide($("logoutButton"));
        }
    } catch (error) {
        console.error("Application startup failed:", error);
        notify("Application could not start: " + friendlyError(error), "error");
    }
}

/* Handle login, logout, and password recovery events */

db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
        currentUser = null;
        profile = null;

        hide($("dashboard"));
        hide($("resetPasswordSection"));
        hide($("logoutButton"));
        reveal($("authSection"));

        if ($("headerUser")) {
            $("headerUser").textContent = "Welcome";
        }
    }

    if (event === "PASSWORD_RECOVERY") {
        hide($("authSection"));
        hide($("dashboard"));
        reveal($("resetPasswordSection"));
        notify("Enter and confirm your new password.");
    }
});

startApp();

