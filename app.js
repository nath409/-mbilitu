
const SUPABASE_URL = "https://mbieizajeifupzuokefx.supabase.co";
const SUPABASE_KEY = "sb_publishable_0ns5_TamqKpwft8NV1rkKw_MebMI8d0";

const db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let currentUser = null;
let profile = null;
let programs = [];
let rooms = [];
let posts = [];

function notify(message) {
    $("message").textContent = message;
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function dateText(value) {
    return new Date(value).toLocaleString();
}

async function loadPrograms() {
    const { data, error } = await db
        .from("programs")
        .select("id,name")
        .order("name");

    if (error) throw error;

    programs = data || [];

    ["signupProgram", "targetProgram"].forEach(id => {
        const select = $(id);
        select.innerHTML = id === "targetProgram"
            ? '<option value="">No programme</option>'
            : '<option value="">Choose your programme</option>';

        programs.forEach(program => {
            select.add(new Option(program.name, program.id));
        });
    });
}

async function loadProfile() {
    const { data, error } = await db
        .from("profiles")
        .select("id,full_name,role,program_id")
        .eq("id", currentUser.id)
        .single();

    if (error) throw error;

    profile = data;
    if (!profile) throw new Error("Your user profile was not found.");
}

async function loadRooms() {
    const { data, error } = await db
        .from("classrooms")
        .select("*")
        .order("name");

    if (error) throw error;
    rooms = data || [];
}

async function loadPosts() {
    const { data, error } = await db
        .from("lecture_posts")
        .select("*,classrooms(name,building,image_url),programs(name)")
        .order("start_time", { ascending: true });

    if (error) throw error;

    posts = data || [];
}

function activeAt(post, now = Date.now()) {
    const start = new Date(post.start_time).getTime();
    const end = start + post.duration_minutes * 60000;

    return !post.cancelled && start <= now && now < end;
}

function renderRooms() {
    const now = Date.now();

    $("classroomList").innerHTML = rooms.map(room => {
        const roomPosts = posts.filter(post =>
            post.classroom_id === room.id && activeAt(post, now)
        );

        const status = roomPosts.length ? "In use" : "Empty";
        const statusClass = roomPosts.length ? "occupied" : "empty";

        const image = room.image_url
            ? `<img src="${escapeHTML(room.image_url)}"
                    alt="${escapeHTML(room.name)}">`
            : "";

        const currentLectures = roomPosts.map(post =>
            `<p>${escapeHTML(post.title)} — ${escapeHTML(post.programs?.name || "")}</p>`
        ).join("");

        return `
            <article class="room">
                <h3>${escapeHTML(room.name)}</h3>
                ${image}
                <p>Building: ${escapeHTML(room.building)}</p>
                <p>Capacity: ${room.capacity}</p>
                <p class="status ${statusClass}">Status: ${status}</p>
                ${currentLectures}
            </article>
        `;
    }).join("") || "<p>No classrooms have been added yet.</p>";

    $("postRoom").innerHTML = '<option value="">Choose classroom</option>';

    rooms.forEach(room => {
        $("postRoom").add(new Option(room.name, room.id));
    });
}

function renderPosts() {
    // RLS is the real security boundary. This filter is an
    // additional interface safeguard for students.
    const visiblePosts = profile.role === "student"
        ? posts.filter(post => post.program_id === profile.program_id)
        : posts;

    $("postsHeading").textContent = profile.role === "student"
        ? "Announcements for your programme"
        : "All programme announcements";

    $("postsList").innerHTML = visiblePosts.map(post => {
        const isOwner = post.posted_by === currentUser.id;
        const canCancel = !post.cancelled &&
            (profile.role === "admin" || isOwner);

        return `
            <article class="post">
                <h3>${escapeHTML(post.title)}</h3>
                <p><strong>Programme:</strong>
                    ${escapeHTML(post.programs?.name || "Unknown")}</p>
                <p><strong>Classroom:</strong>
                    ${escapeHTML(post.classrooms?.name || "Unknown")}</p>
                <p><strong>Building:</strong>
                    ${escapeHTML(post.classrooms?.building || "")}</p>
                <p><strong>Starts:</strong> ${dateText(post.start_time)}</p>
                <p><strong>Duration:</strong> ${post.duration_minutes} minutes</p>
                <p>${escapeHTML(post.details)}</p>
                ${post.cancelled
                    ? '<p class="cancelled">LECTURE CANCELLED</p>'
                    : ""}
                ${canCancel
                    ? `<button data-cancel="${post.id}">Cancel lecture</button>`
                    : ""}
            </article>
        `;
    }).join("") || "<p>No announcements available.</p>";

    document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", () =>
            cancelPost(Number(button.dataset.cancel))
        );
    });
}

async function refreshDashboard() {
    await Promise.all([loadRooms(), loadPosts()]);
    renderRooms();
    renderPosts();
}

async function showDashboard() {
    await loadProfile();

    $("authSection").hidden = true;
    $("dashboard").hidden = false;
    $("logoutBtn").hidden = false;

    const program = programs.find(p => p.id === profile.program_id);

    $("welcomeTitle").textContent =
        `Welcome, ${profile.full_name || "User"}`;

    $("userInfo").textContent =
        `Role: ${profile.role.replace("_", " ")} | Programme: ${program?.name || "Not assigned"}`;

    $("adminPanel").hidden = profile.role !== "admin";
    $("repPanel").hidden = profile.role !== "class_rep";

    await refreshDashboard();
}

$("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        notify("Logging in...");

        const email = $("email").value.trim();
        const password = $("password").value;

        if (!email || !password) {
            notify("Please enter your email and password.");
            return;
        }

        const { data, error } = await db.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error("Supabase login error:", error);
            throw error;
        }

        currentUser = data.user;

        await loadPrograms();
        await showDashboard();

        notify("Login successful.");

    } catch (error) {
        console.error("Login failed:", error);
        notify("Login failed: " + error.message);
    }
});




$("signupForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        notify("Creating account...");

        const { data, error } = await db.auth.signUp({
            email: $("signupEmail").value.trim(),
            password: $("signupPassword").value,
            options: {
                data: {
                    full_name: $("fullName").value.trim()
                }
            }
        });

        if (error) throw error;

        // Account confirmation may be required by Supabase.
        if (!data.session) {
            notify("Account created. Check your email to confirm, then log in. Ask an admin to assign your programme.");
            return;
        }

        currentUser = data.user;

        // Users may choose only their own programme, not their role.
        const programId = Number($("signupProgram").value);

        if (!programId) {
            notify("Account created. Log in and ask an admin to assign your programme.");
            return;
        }

        const { error: updateError } = await db
            .from("profiles")
            .update({ program_id: programId })
            .eq("id", currentUser.id);

        if (updateError) throw updateError;

        await loadPrograms();
        await showDashboard();
        notify("Student account created.");
    } catch (error) {
        notify(error.message);
    }
});

$("classroomForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        notify("Saving classroom...");

        let imageUrl = null;
        const file = $("roomImage").files[0];

        if (file) {
            if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
                throw new Error("Choose an image under 5 MB.");
            }

            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = `${crypto.randomUUID()}-${safeName}`;

            const { error: uploadError } = await db.storage
                .from("classroom-images")
                .upload(path, file, { upsert: false });

            if (uploadError) throw uploadError;

            imageUrl = db.storage
                .from("classroom-images")
                .getPublicUrl(path).data.publicUrl;
        }

        const { error } = await db.from("classrooms").insert({
            name: $("roomName").value.trim(),
            building: $("building").value.trim(),
            capacity: Number($("capacity").value),
            image_url: imageUrl
        });

        if (error) throw error;

        $("classroomForm").reset();
        await refreshDashboard();
        notify("Classroom saved successfully.");
    } catch (error) {
        notify(error.message);
    }
});

$("roleForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const uid = $("targetUid").value.trim();
        const role = $("targetRole").value;
        const programValue = $("targetProgram").value;

        const { error } = await db.from("profiles")
            .update({
                role,
                program_id: programValue ? Number(programValue) : null
            })
            .eq("id", uid);

        if (error) throw error;

        notify("User role and programme updated.");
    } catch (error) {
        notify(error.message);
    }
});

$("postForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        if (!profile.program_id) {
            throw new Error("An administrator must assign your programme first.");
        }

        const start = new Date($("postStart").value);

        if (Number.isNaN(start.getTime()) || start <= new Date()) {
            throw new Error("Choose a future lecture start time.");
        }

        const roomId = Number($("postRoom").value);
        const duration = Number($("postDuration").value);
        const end = start.getTime() + duration * 60000;

        const conflict = posts.some(post => {
            if (post.classroom_id !== roomId || post.cancelled) return false;

            const otherStart = new Date(post.start_time).getTime();
            const otherEnd = otherStart + post.duration_minutes * 60000;

            return start.getTime() < otherEnd && end > otherStart;
        });

        if (conflict) {
            throw new Error("This classroom already has a scheduled lecture during that time.");
        }

        const { error } = await db.from("lecture_posts").insert({
            program_id: profile.program_id,
            classroom_id: roomId,
            posted_by: currentUser.id,
            title: $("postTitle").value.trim(),
            details: $("postDetails").value.trim(),
            start_time: start.toISOString(),
            duration_minutes: duration
        });

        if (error) throw error;

        $("postForm").reset();
        await refreshDashboard();
        notify("Lecture announcement published.");
    } catch (error) {
        notify(error.message);
    }
});

async function cancelPost(id) {
    if (!confirm("Are you sure you want to cancel this lecture?")) return;

    try {
        const { error } = await db
            .from("lecture_posts")
            .update({ cancelled: true })
            .eq("id", id);

        if (error) throw error;

        await refreshDashboard();
        notify("Lecture cancelled.");
    } catch (error) {
        notify(error.message);
    }
}

$("logoutBtn").addEventListener("click", async () => {
    const { error } = await db.auth.signOut();

    if (error) {
        notify(error.message);
        return;
    }

    currentUser = null;
    profile = null;
    $("dashboard").hidden = true;
    $("authSection").hidden = false;
    $("logoutBtn").hidden = true;
    notify("You have logged out.");
});

async function startApp() {
    try {
        if (SUPABASE_URL.includes("YOUR_") ||
            SUPABASE_KEY.includes("YOUR_")) {
            notify("Add your Supabase Project URL and publishable key in app.js.");
            return;
        }

        await loadPrograms();

        const { data, error } = await db.auth.getSession();
        if (error) throw error;

        if (data.session) {
            currentUser = data.session.user;
            await showDashboard();
        }
    } catch (error) {
        notify(error.message);
    }
}

db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
        currentUser = null;
        profile = null;
        $("dashboard").hidden = true;
        $("authSection").hidden = false;
        $("logoutBtn").hidden = true;
    }
});

startApp();
