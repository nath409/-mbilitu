// =============================================
// MUKUBA UNIVERSITY CLASSROOM MANAGEMENT SYSTEM
// =============================================

const SUPABASE_URL = "https://mbieizajeifupzuokefx.supabase.co";
const SUPABASE_KEY = "sb_publishable_0ns5_TamqKpwft8NV1rkKw_MebMI8d0";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let profile = null;
let programs = [];
let rooms = [];
let posts = [];
let messageTimeout = null;
let authInitialized = false;
let recoveryMode = false;

// =============================================
// GENERAL HELPERS
// =============================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function notify(message, type = "success") {
    const region = $("toastRegion");

    if (region) {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        region.appendChild(toast);

        window.setTimeout(() => toast.remove(), 4500);
    }

    const messageBox = $("message");

    if (messageBox) {
        messageBox.textContent = message;
        messageBox.className = `message ${type}`;
        messageBox.classList.remove("hidden");

        clearTimeout(messageTimeout);
        messageTimeout = window.setTimeout(() => {
            messageBox.classList.add("hidden");
        }, 6000);
    }
}

function showError(error, fallback = "Something went wrong.") {
    console.error(error);
    notify(error?.message || fallback, "error");
}

function setLoading(form, loading, loadingText = "Please wait...") {
    const button = form?.querySelector('button[type="submit"]');

    if (!button) return;

    if (loading) {
        button.dataset.originalText = button.textContent;
        button.textContent = loadingText;
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || "Submit";
        button.disabled = false;
    }
}

function dateText(value) {
    if (!value) return "Not specified";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Invalid date";

    return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function escapeAttribute(value) {
    return escapeHTML(value);
}

function selectedProgramName() {
    return programs.find(
        (program) => program.id === profile?.program_id
    )?.name || "Not assigned";
}

function roleName(role) {
    const names = {
        student: "Student",
        lecturer: "Lecturer",
        class_rep: "Class Representative",
        admin: "Administrator"
    };

    return names[role] || "User";
}

function getPostEnd(post) {
    const start = new Date(post.start_time).getTime();
    const duration = Number(post.duration_minutes) || 0;

    return start + duration * 60 * 1000;
}

function activeAt(post) {
    const now = Date.now();
    const start = new Date(post.start_time).getTime();

    return !post.cancelled &&
        now >= start &&
        now < getPostEnd(post);
}

function postStatus(post) {
    if (post.cancelled) return "cancelled";

    const now = Date.now();
    const start = new Date(post.start_time).getTime();
    const end = getPostEnd(post);

    if (now < start) return "upcoming";
    if (now < end) return "active";

    return "past";
}

function postStatusLabel(status) {
    const labels = {
        upcoming: "Upcoming",
        active: "In progress",
        cancelled: "Cancelled",
        past: "Past lecture"
    };

    return labels[status] || status;
}

function roomIsOccupied(roomId) {
    return posts.some((post) => {
        if (String(post.classroom_id) !== String(roomId)) return false;
        if (post.cancelled) return false;

        const start = new Date(post.start_time).getTime();
        const end = getPostEnd(post);
        const now = Date.now();

        return now >= start && now < end;
    });
}

function canManagePost(post) {
    return profile?.role === "admin" ||
        post.posted_by === currentUser?.id;
}

// =============================================
// NAVIGATION
// =============================================

function showPage(pageId) {
    document.querySelectorAll(".page").forEach((page) => {
        page.classList.toggle("active", page.id === pageId);
    });

    document.querySelectorAll(".nav-item").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageId
        );
    });

    if (pageId === "classroomsPage") renderRooms();
    if (pageId === "announcementsPage") renderPosts();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

window.showPage = showPage;

document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

document.querySelectorAll("[data-go-page]").forEach((button) => {
    button.addEventListener("click", () => {
        showPage(button.dataset.goPage);
    });
});

// =============================================
// LOAD PROGRAMMES
// =============================================

async function loadPrograms() {
    const { data, error } = await supabaseClient
        .from("programs")
        .select("id, name")
        .order("name");

    if (error) throw error;

    programs = data || [];

    ["signupProgram", "targetProgram"].forEach((id) => {
        const select = $(id);
        if (!select) return;

        const previousValue = select.value;
        const firstOption = id === "signupProgram"
            ? "Select your programme"
            : "No programme";

        select.innerHTML = "";

        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = firstOption;
        select.appendChild(emptyOption);

        programs.forEach((program) => {
            const option = document.createElement("option");
            option.value = program.id;
            option.textContent = program.name;
            select.appendChild(option);
        });

        if ([...select.options].some(
            (option) => option.value === previousValue
        )) {
            select.value = previousValue;
        }
    });
}

// =============================================
// LOAD PROFILE
// =============================================

async function loadProfile() {
    if (!currentUser) {
        profile = null;
        return;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, role, program_id")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error) throw error;

    profile = data;
}

// =============================================
// LOAD CLASSROOMS
// =============================================

async function loadRooms() {
    const { data, error } = await supabaseClient
        .from("classrooms")
        .select("id, name, building, capacity, image_url")
        .order("name");

    if (error) throw error;

    rooms = data || [];
}

// =============================================
// LOAD LECTURE ANNOUNCEMENTS
// =============================================

async function loadPosts() {
    const { data, error } = await supabaseClient
        .from("lecture_posts")
        .select(`
            *,
            classrooms(name, building, image_url),
            programs(name)
        `)
        .order("start_time", { ascending: true });

    if (error) throw error;

    posts = data || [];
}

// =============================================
// RENDER CLASSROOMS
// =============================================

function renderRooms() {
    const list = $("classroomList");
    const overviewList = $("overviewRoomList");
    const postRoom = $("postRoom");

    const search = ($("roomSearch")?.value || "").toLowerCase().trim();
    const statusFilter = $("roomStatusFilter")?.value || "all";

    if (postRoom) {
        const previousValue = postRoom.value;
        postRoom.innerHTML = '<option value="">Select a classroom</option>';

        rooms.forEach((room) => {
            const option = document.createElement("option");
            option.value = room.id;
            option.textContent = `${room.name} — ${room.building}`;
            postRoom.appendChild(option);
        });

        if ([...postRoom.options].some(
            (option) => option.value === previousValue
        )) {
            postRoom.value = previousValue;
        }
    }

    const filteredRooms = rooms.filter((room) => {
        const searchable = `${room.name} ${room.building}`.toLowerCase();

        if (!searchable.includes(search)) return false;

        const occupied = roomIsOccupied(room.id);

        if (statusFilter === "available" && occupied) return false;
        if (statusFilter === "occupied" && !occupied) return false;

        return true;
    });

    if (list) {
        if (!filteredRooms.length) {
            list.innerHTML = `
                <div class="empty-state">
                    <strong>No classrooms found</strong>
                    Try another search or availability filter.
                </div>`;
        } else {
            list.innerHTML = filteredRooms.map((room) => {
                const occupied = roomIsOccupied(room.id);
                const status = occupied ? "occupied" : "available";
                const statusLabel = occupied ? "In use" : "Available";

                const image = room.image_url
                    ? `<img class="room-image"
                         src="${escapeAttribute(room.image_url)}"
                         alt="${escapeAttribute(room.name)}"
                         loading="lazy">`
                    : `<div class="room-image-placeholder"
                            aria-label="No classroom photo">🏫</div>`;

                return `
                    <article class="room-card">
                        ${image}
                        <div class="room-content">
                            <h3>${escapeHTML(room.name)}</h3>
                            <p class="room-meta">
                                📍 ${escapeHTML(room.building || "Building not specified")}
                            </p>
                            <div class="room-footer">
                                <span class="status status-${status}">
                                    ${statusLabel}
                                </span>
                                <span class="muted small-text">
                                    👥 ${escapeHTML(room.capacity ?? "—")} seats
                                </span>
                            </div>
                        </div>
                    </article>`;
            }).join("");
        }
    }

    if (overviewList) {
        const preview = [...rooms].slice(0, 5);

        overviewList.innerHTML = preview.length
            ? preview.map((room) => {
                const occupied = roomIsOccupied(room.id);

                return `
                    <div class="mini-item">
                        <div>
                            <strong>${escapeHTML(room.name)}</strong>
                            <small>${escapeHTML(room.building || "Building not specified")}</small>
                        </div>
                        <span class="status status-${occupied ? "occupied" : "available"}">
                            ${occupied ? "In use" : "Available"}
                        </span>
                    </div>`;
            }).join("")
            : `<div class="empty-state">No classrooms have been added yet.</div>`;
    }

    updateStats();
}

// =============================================
// RENDER ANNOUNCEMENTS
// =============================================

function renderPosts() {
    const list = $("postsList");
    const overviewList = $("overviewPostList");

    const search = ($("postSearch")?.value || "").toLowerCase().trim();
    const statusFilter = $("postStatusFilter")?.value || "all";

    let visiblePosts = [...posts];

    // Students see announcements for their assigned programme.
    // RLS must also enforce this restriction in Supabase.
    if (profile?.role === "student") {
        visiblePosts = visiblePosts.filter(
            (post) => String(post.program_id) === String(profile.program_id)
        );
    }

    visiblePosts.sort(
        (a, b) => new Date(a.start_time) - new Date(b.start_time)
    );

    const filteredPosts = visiblePosts.filter((post) => {
        const roomName = post.classrooms?.name || "";
        const programName = post.programs?.name || "";

        const searchable = [
            post.title,
            post.details,
            roomName,
            programName
        ].join(" ").toLowerCase();

        if (!searchable.includes(search)) return false;

        const status = postStatus(post);

        if (statusFilter !== "all" && status !== statusFilter) {
            return false;
        }

        return true;
    });

    if (list) {
        list.innerHTML = filteredPosts.length
            ? filteredPosts.map((post) => {
                const status = postStatus(post);
                const roomName = post.classrooms?.name || "Classroom";
                const building = post.classrooms?.building || "Building not specified";
                const programName = post.programs?.name || "Programme not specified";

                const cancelButton = !post.cancelled && canManagePost(post)
                    ? `<button class="button-danger"
                               type="button"
                               data-cancel-post="${escapeAttribute(post.id)}">
                           Cancel lecture
                       </button>`
                    : "";

                return `
                    <article class="post-card">
                        <div class="post-top">
                            <div>
                                <h3>${escapeHTML(post.title)}</h3>
                                <span class="post-program">${escapeHTML(programName)}</span>
                            </div>
                            <span class="status status-${status}">
                                ${postStatusLabel(status)}
                            </span>
                        </div>

                        <div class="post-info">
                            <div>🏫 <span>${escapeHTML(roomName)} — ${escapeHTML(building)}</span></div>
                            <div>🗓️ <span>${escapeHTML(dateText(post.start_time))}</span></div>
                            <div>⏱️ <span>${escapeHTML(post.duration_minutes)} minutes</span></div>
                        </div>

                        ${post.details
                            ? `<p class="post-details">${escapeHTML(post.details)}</p>`
                            : ""}

                        <div class="post-footer">
                            <small>${post.cancelled ? "This lecture was cancelled." : "Lecture announcement"}</small>
                            ${cancelButton}
                        </div>
                    </article>`;
            }).join("")
            : `<div class="empty-state">
                   <strong>No announcements found</strong>
                   Try changing your search or status filter.
               </div>`;

        list.querySelectorAll("[data-cancel-post]").forEach((button) => {
            button.addEventListener("click", () => {
                cancelPost(button.dataset.cancelPost);
            });
        });
    }

    if (overviewList) {
        const preview = visiblePosts
            .filter((post) => !post.cancelled)
            .slice(0, 5);

        overviewList.innerHTML = preview.length
            ? preview.map((post) => `
                <div class="mini-item">
                    <div>
                        <strong>${escapeHTML(post.title)}</strong>
                        <small>
                            ${escapeHTML(post.classrooms?.name || "Classroom")} ·
                            ${escapeHTML(dateText(post.start_time))}
                        </small>
                    </div>
                    <span class="status status-${postStatus(post)}">
                        ${postStatusLabel(postStatus(post))}
                    </span>
                </div>
            `).join("")
            : `<div class="empty-state">No current announcements to display.</div>`;
    }

    updateStats();
}

// =============================================
// UPDATE DASHBOARD STATISTICS
// =============================================

function updateStats() {
    const visiblePosts = profile?.role === "student"
        ? posts.filter(
            (post) => String(post.program_id) === String(profile.program_id)
        )
        : posts;

    if ($("totalRooms")) $("totalRooms").textContent = rooms.length;

    if ($("availableRooms")) {
        $("availableRooms").textContent =
            rooms.filter((room) => !roomIsOccupied(room.id)).length;
    }

    if ($("totalPosts")) {
        $("totalPosts").textContent = visiblePosts.length;
    }
}

// =============================================
// DISPLAY USER DASHBOARD
// =============================================

function showDashboard() {
    $("authSection")?.classList.add("hidden");
    $("resetPasswordSection")?.classList.add("hidden");
    $("dashboard")?.classList.remove("hidden");
    $("logoutButton")?.classList.remove("hidden");

    const name = profile?.full_name ||
        currentUser?.user_metadata?.full_name ||
        currentUser?.email ||
        "User";

    const role = profile?.role || "student";
    const programName = selectedProgramName();

    $("welcomeName").textContent = `Welcome, ${name}`;
    $("welcomeInfo").textContent =
        `${roleName(role)} · ${programName}`;

    $("headerUser").textContent = name;
    $("profileName").textContent = name;
    $("profileEmail").textContent = currentUser?.email || "";
    $("profileRole").textContent = roleName(role);
    $("profileProgram").textContent = programName;
    $("profileAvatar").textContent = name.trim().charAt(0).toUpperCase() || "U";

    const isAdmin = role === "admin";
    const canPost = role === "class_rep" || role === "admin";

    $("adminNav")?.classList.toggle("hidden", !isAdmin);
    $("adminPanel")?.classList.toggle("hidden", !isAdmin);
    $("adminNotice")?.classList.toggle("hidden", isAdmin);
    $("repPanel")?.classList.toggle("hidden", !canPost);

    // Keep the existing database RLS policies in mind:
    // a visible form does not grant database permission.
    if (canPost && role === "admin") {
        const note = document.createElement("p");
        note.className = "muted small-text";
        note.textContent =
            "Publishing is subject to the permissions configured in Supabase.";
        $("repPanel").appendChild(note);
    }

    showPage("overviewPage");
}

// =============================================
// REFRESH APPLICATION DATA
// =============================================

async function refreshDashboard() {
    try {
        await Promise.all([
            loadPrograms(),
            loadProfile(),
            loadRooms(),
            loadPosts()
        ]);

        showDashboard();
        renderRooms();
        renderPosts();
    } catch (error) {
        showError(error, "Unable to load the dashboard.");
    }
}

// =============================================
// LOGIN
// =============================================

$("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    setLoading(form, true, "Signing in...");

    try {
        const { error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        notify("Login successful.");
    } catch (error) {
        showError(error, "Unable to sign in. Check your email and password.");
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// STUDENT REGISTRATION
// =============================================

$("signupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const fullName = $("signupName").value.trim();
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;
    const programId = $("signupProgram").value || null;

    setLoading(form, true, "Creating account...");

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName
                },
                emailRedirectTo: window.location.origin
            }
        });

        if (error) throw error;

        // This assumes a profiles row is created for each new auth user,
        // for example by your existing Supabase database trigger.
        // If email confirmation is required, there may be no session yet.
        if (data.session && data.user && programId) {
            const { error: profileError } = await supabaseClient
                .from("profiles")
                .update({
                    full_name: fullName,
                    program_id: programId
                })
                .eq("id", data.user.id);

            if (profileError) {
                console.error("Profile update error:", profileError);
                notify(
                    "Account created, but programme assignment needs attention. Ask an administrator.",
                    "warning"
                );
            } else {
                notify("Account created successfully.");
            }
        } else {
            notify(
                "Registration submitted. Check your email if confirmation is required. If your programme is not assigned, ask an administrator.",
                "success"
            );
        }

        form.reset();
    } catch (error) {
        showError(error, "Unable to create your account.");
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// FORGOT PASSWORD
// =============================================

$("forgotPasswordLink")?.addEventListener("click", async (event) => {
    event.preventDefault();

    const email = $("loginEmail").value.trim();

    if (!email) {
        notify("Enter your email address in the sign-in form first.", "warning");
        $("loginEmail").focus();
        return;
    }

    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(
            email,
            {
                redirectTo: window.location.origin
            }
        );

        if (error) throw error;

        notify(
            "If the email is registered, a password-reset link will be sent. Check your inbox."
        );
    } catch (error) {
        showError(error, "Unable to send the password-reset email.");
    }
});

// =============================================
// PASSWORD RESET
// =============================================

$("resetPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const password = $("newPassword").value;
    const confirmPassword = $("confirmPassword").value;

    if (password.length < 6) {
        notify("Your password must contain at least 6 characters.", "warning");
        return;
    }

    if (password !== confirmPassword) {
        notify("The passwords do not match.", "error");
        return;
    }

    setLoading(form, true, "Updating password...");

    try {
        const { error } = await supabaseClient.auth.updateUser({
            password
        });

        if (error) throw error;

        notify("Password changed successfully. You can now use your new password.");
        form.reset();

        recoveryMode = false;
        $("resetPasswordSection").classList.add("hidden");
        $("authSection").classList.remove("hidden");
    } catch (error) {
        showError(error, "Unable to update your password.");
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// ADD CLASSROOM AND UPLOAD PHOTO
// =============================================

$("classroomForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (profile?.role !== "admin") {
        notify("Only administrators can add classrooms.", "error");
        return;
    }

    const form = event.currentTarget;
    const name = $("roomName").value.trim();
    const building = $("roomBuilding").value.trim();
    const capacity = Number($("roomCapacity").value);
    const imageFile = $("roomImage").files[0];

    if (!name || !building || !Number.isInteger(capacity) || capacity < 1) {
        notify("Enter a classroom name, building and valid capacity.", "warning");
        return;
    }

    if (imageFile && imageFile.size > 5 * 1024 * 1024) {
        notify("The image must be smaller than 5 MB.", "warning");
        return;
    }

    setLoading(form, true, "Saving classroom...");

    try {
        let imageUrl = null;

        if (imageFile) {
            const extension = imageFile.name.split(".").pop()
                .toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

            const filePath =
                `${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

            const { error: uploadError } = await supabaseClient.storage
                .from("classroom-images")
                .upload(filePath, imageFile, {
                    upsert: false,
                    contentType: imageFile.type
                });

            if (uploadError) throw uploadError;

            const { data } = supabaseClient.storage
                .from("classroom-images")
                .getPublicUrl(filePath);

            imageUrl = data.publicUrl;
        }

        const { error } = await supabaseClient
            .from("classrooms")
            .insert({
                name,
                building,
                capacity,
                image_url: imageUrl
            });

        if (error) throw error;

        form.reset();
        await loadRooms();
        renderRooms();

        notify("Classroom added successfully.");
    } catch (error) {
        showError(
            error,
            "Unable to add classroom. Check the classroom table and storage permissions."
        );
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// ASSIGN ROLE AND PROGRAMME
// =============================================

$("roleForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (profile?.role !== "admin") {
        notify("Only administrators can assign user roles.", "error");
        return;
    }

    const form = event.currentTarget;
    const userId = $("targetUserId").value.trim();
    const role = $("targetRole").value;
    const programId = $("targetProgram").value || null;

    setLoading(form, true, "Updating user...");

    try {
        const { data, error } = await supabaseClient
            .from("profiles")
            .update({
                role,
                program_id: programId
            })
            .eq("id", userId)
            .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error(
                "No profile was updated. Check the user ID and your Supabase permissions."
            );
        }

        form.reset();
        notify("User role and programme updated.");
    } catch (error) {
        showError(error, "Unable to update the user's profile.");
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// POST LECTURE ANNOUNCEMENT
// =============================================

$("postForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const role = profile?.role;

    if (!["class_rep", "admin"].includes(role)) {
        notify("Your account cannot publish lecture announcements.", "error");
        return;
    }

    if (!profile?.program_id) {
        notify("Your account needs a programme assignment first.", "warning");
        return;
    }

    const form = event.currentTarget;
    const title = $("postTitle").value.trim();
    const details = $("postDetails").value.trim();
    const classroomId = $("postRoom").value;
    const startValue = $("postStart").value;
    const duration = Number($("postDuration").value);
    const startDate = new Date(startValue);

    if (!title || !classroomId || !startValue ||
        Number.isNaN(startDate.getTime()) ||
        !Number.isInteger(duration) || duration < 1) {
        notify("Complete all required fields with valid values.", "warning");
        return;
    }

    if (startDate.getTime() <= Date.now()) {
        notify("Choose a future date and time for the lecture.", "warning");
        return;
    }

    const selectedRoom = rooms.find(
        (room) => String(room.id) === String(classroomId)
    );

    if (!selectedRoom) {
        notify("Select a valid classroom.", "warning");
        return;
    }

    const startMs = startDate.getTime();
    const endMs = startMs + duration * 60 * 1000;

    const conflict = posts.some((post) => {
        if (post.cancelled) return false;
        if (String(post.classroom_id) !== String(classroomId)) return false;

        const existingStart = new Date(post.start_time).getTime();
        const existingEnd = getPostEnd(post);

        // Intervals overlap if each starts before the other one ends.
        return startMs < existingEnd && endMs > existingStart;
    });

    if (conflict) {
        notify(
            "That classroom already has a lecture scheduled during this time.",
            "error"
        );
        return;
    }

    setLoading(form, true, "Publishing...");

    try {
        const { error } = await supabaseClient
            .from("lecture_posts")
            .insert({
                program_id: profile.program_id,
                classroom_id: classroomId,
                posted_by: currentUser.id,
                title,
                details: details || null,
                start_time: startDate.toISOString(),
                duration_minutes: duration,
                cancelled: false
            });

        if (error) throw error;

        form.reset();
        $("postDuration").value = "60";

        await loadPosts();
        renderPosts();
        renderRooms();

        notify("Lecture announcement published.");
        showPage("announcementsPage");
    } catch (error) {
        showError(
            error,
            "Unable to publish. Check the lecture_posts table and Supabase RLS policies."
        );
    } finally {
        setLoading(form, false);
    }
});

// =============================================
// CANCEL ANNOUNCEMENT
// =============================================

async function cancelPost(postId) {
    const post = posts.find(
        (item) => String(item.id) === String(postId)
    );

    if (!post) {
        notify("Announcement not found. Refresh the dashboard.", "error");
        return;
    }

    if (!canManagePost(post)) {
        notify("You are not allowed to cancel this announcement.", "error");
        return;
    }

    if (post.cancelled) {
        notify("This announcement is already cancelled.", "warning");
        return;
    }

    const confirmed = window.confirm(
        `Cancel "${post.title}"? This will mark the announcement as cancelled.`
    );

    if (!confirmed) return;

    try {
        const { error } = await supabaseClient
            .from("lecture_posts")
            .update({ cancelled: true })
            .eq("id", postId);

        if (error) throw error;

        await loadPosts();
        renderPosts();
        renderRooms();

        notify("Lecture announcement cancelled.");
    } catch (error) {
        showError(
            error,
            "Unable to cancel the announcement. Check your Supabase permissions."
        );
    }
}

// =============================================
// SEARCH AND FILTERS
// =============================================

$("roomSearch")?.addEventListener("input", renderRooms);
$("roomStatusFilter")?.addEventListener("change", renderRooms);
$("postSearch")?.addEventListener("input", renderPosts);
$("postStatusFilter")?.addEventListener("change", renderPosts);

$("refreshButton")?.addEventListener("click", async () => {
    const button = $("refreshButton");
    button.disabled = true;
    button.textContent = "Refreshing...";

    await refreshDashboard();

    button.disabled = false;
    button.textContent = "↻ Refresh";
    notify("Dashboard refreshed.");
});

// =============================================
// LOG OUT
// =============================================

$("logoutButton")?.addEventListener("click", async () => {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;

        currentUser = null;
        profile = null;
        rooms = [];
        posts = [];

        $("dashboard").classList.add("hidden");
        $("resetPasswordSection").classList.add("hidden");
        $("authSection").classList.remove("hidden");
        $("logoutButton").classList.add("hidden");
        $("headerUser").textContent = "Welcome";

        notify("You have signed out.");
    } catch (error) {
        showError(error, "Unable to sign out.");
    }
});

// =============================================
// AUTHENTICATION STATE
// =============================================

async function handleAuthSession(session) {
    currentUser = session?.user || null;

    if (!currentUser) {
        if (!recoveryMode) {
            $("dashboard")?.classList.add("hidden");
            $("logoutButton")?.classList.add("hidden");
            $("authSection")?.classList.remove("hidden");
        }
        return;
    }

    try {
        await refreshDashboard();
    } catch (error) {
        showError(error, "Unable to load your account.");
    }
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        $("authSection")?.classList.add("hidden");
        $("dashboard")?.classList.add("hidden");
        $("resetPasswordSection")?.classList.remove("hidden");
        return;
    }

    if (event === "SIGNED_OUT") {
        currentUser = null;
        profile = null;

        if (!recoveryMode) {
            $("dashboard")?.classList.add("hidden");
            $("logoutButton")?.classList.add("hidden");
            $("authSection")?.classList.remove("hidden");
        }
        return;
    }

    // Avoid redundant initial processing when the app is first loaded.
    if (event === "INITIAL_SESSION") {
        if (authInitialized) return;
        authInitialized = true;
    }

    if (session?.user) {
        // Defer database operations until after the auth callback completes.
        setTimeout(() => {
            handleAuthSession(session);
        }, 0);
    }
});

// =============================================
// START APPLICATION
// =============================================

async function startApp() {
    $("currentYear").textContent = new Date().getFullYear();

    try {
        await loadPrograms();
    } catch (error) {
        showError(
            error,
            "Unable to load programmes. Check your programs table and permissions."
        );
    }

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
        showError(error, "Unable to check your login session.");
        return;
    }

    authInitialized = true;

    if (data.session?.user) {
        await handleAuthSession(data.session);
    } else if (!recoveryMode) {
        $("authSection")?.classList.remove("hidden");
        $("dashboard")?.classList.add("hidden");
    }
}

startApp();
