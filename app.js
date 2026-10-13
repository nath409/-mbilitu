
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
    const element = $("message");
    if (element) element.textContent = message;
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
        if (!select) return;

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

    if (!profile) {
        throw new Error("Your user profile was not found.");
    }
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
            String(post.classroom_id) === String(room.id) &&
            activeAt(post, now)
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
                <p>Building: ${escapeHTML(room.building || "")}</p>
                <p>Capacity: ${room.capacity}</p>
                <p class="status ${statusClass}">Status: ${status}</p>
                ${currentLectures}
            </article>
        `;
    }).join("") || "<p>No classrooms have been added yet.</p>";

    $("postRoom").innerHTML =
        '<option value="">Choose classroom</option>';

    rooms.forEach(room => {
        $("postRoom").add(new Option(room.name, room.id));
    });
}

function renderPosts() {
    const visiblePosts = profile.role === "student"
        ? posts.filter(post =>
            String(post.program_id) === String(profile.program_id)
        )
        : posts;

    $("postsHeading").textContent = profile.role === "student"
        ? "Announcements for your programme"
        : "All programme announcements";

    $("postsList").innerHTML = visiblePosts.map(post => {
        const isOwner =
            String(post.posted_by) === String(currentUser.id);

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

                <p><strong>Starts:</strong>
                    ${dateText(post.start_time)}</p>

                <p><strong>Duration:</strong>
                    ${post.duration_minutes} minutes</p>

                <p>${escapeHTML(post.details || "")}</p>

                ${post.cancelled
                    ? '<p class="cancelled">LECTURE CANCELLED</p>'
                    : ""}

                ${canCancel
                    ? `<button type="button" data-cancel="${post.id}">Cancel lecture</button>`
                    : ""}
            </article>
        `;
    }).join("") || "<p>No announcements available.</p>";

    document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", () => {
            cancelPost(Number(button.dataset.cancel));
        });
    });
}

async function refreshDashboard() {
    await Promise.all([
        loadRooms(),
        loadPosts()
    ]);

    renderRooms();
    renderPosts();
}

async function showDashboard() {
    await loadProfile();

    $("authSection").hidden = true;
    $("dashboard").hidden = false;
    $("logoutBtn").hidden = false;

    const program = programs.find(
        p => String(p.id) === String(profile.program_id)
    );

    $("welcomeTitle").textContent =
        `Welcome, ${profile.full_name || "User"}`;

    $("userInfo").textContent =
        `Role: ${profile.role.replace("_", " ")} | Programme: ${program?.name || "Not assigned"}`;

    $("adminPanel").hidden = profile.role !== "admin";
    $("repPanel").hidden = profile.role !== "class_rep";

    await refreshDashboard();
}

// LOGIN
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

        if (error) throw error;

        currentUser = data.user;

        await loadPrograms();
        await showDashboard();

        notify("Login successful.");

    } catch (error) {
        console.error("Login failed:", error);
        notify("Login failed: " + error.message);
    }
});

// SIGN UP
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

        if (!data.session) {
            notify(
                "Account created. Check your email to confirm, then log in. Ask an admin to assign your programme."
            );
            return;
        }

        currentUser = data.user;

        const programId = Number($("signupProgram").value);

        if (!programId) {
            notify(
                "Account created. Log in and ask an admin to assign your programme."
            );
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
        console.error("Sign-up failed:", error);
        notify("Sign-up failed: " + error.message);
    }
});

// ADD CLASSROOM
$("classroomForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        notify("Saving classroom...");

        let imageUrl = null;
        const file = $("roomImage").files[0];

        if (file) {
            if (
                !file.type.startsWith("image/") ||
                file.size > 5 * 1024 * 1024
            ) {
                throw new Error("Choose an image under 5 MB.");
            }

            const safeName = file.name.replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );

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
        console.error("Classroom error:", error);
        notify("Classroom error: " + error.message);
    }
});

// UPDATE USER ROLE AND PROGRAMME
$("roleForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const uid = $("targetUid").value.trim();
        const role = $("targetRole").value;
        const programValue = $("targetProgram").value;

        if (!uid) {
            throw new Error("Enter the user's ID.");
        }

        const { error } = await db
            .from("profiles")
            .update({
                role,
                program_id: programValue
                    ? Number(programValue)
                    : null
            })
            .eq("id", uid);

        if (error) throw error;

        notify("User role and programme updated.");

    } catch (error) {
        console.error("Role update error:", error);
        notify("Role update error: " + error.message);
    }
});

// POST LECTURE ANNOUNCEMENT
$("postForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        notify("Publishing lecture announcement...");

        if (!currentUser || !profile) {
            throw new Error("Please log in again.");
        }

        if (profile.role !== "class_rep" && profile.role !== "admin") {
            throw new Error(
                "Only class representatives and administrators can post lectures."
            );
        }

        if (!profile.program_id) {
            throw new Error(
                "An administrator must assign your programme first."
            );
        }

        const start = new Date($("postStart").value);

        if (
            !Number.isFinite(start.getTime()) ||
            start <= new Date()
        ) {
            throw new Error("Choose a future lecture start time.");
        }

        const roomId = Number($("postRoom").value);
        const duration = Number($("postDuration").value);
        const title = $("postTitle").value.trim();
        const details = $("postDetails").value.trim();

        if (!roomId || !rooms.some(
            room => String(room.id) === String(roomId)
        )) {
            throw new Error("Please select a valid classroom.");
        }

        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error("Enter a valid lecture duration.");
        }

        if (!title) {
            throw new Error("Enter the lecture title.");
        }

        const end = start.getTime() + duration * 60000;

        const conflict = posts.some(post => {
            if (
                String(post.classroom_id) !== String(roomId) ||
                post.cancelled
            ) {
                return false;
            }

            const otherStart = new Date(post.start_time).getTime();
            const otherEnd =
                otherStart + Number(post.duration_minutes) * 60000;

            return (
                start.getTime() < otherEnd &&
                end > otherStart
            );
        });

        if (conflict) {
            throw new Error(
                "This classroom already has a scheduled lecture during that time."
            );
        }

        const lectureData = {
            program_id: profile.program_id,
            classroom_id: roomId,
            posted_by: currentUser.id,
            title,
            details,
            start_time: start.toISOString(),
            duration_minutes: duration
        };

        console.log("Submitting lecture announcement.");

        const { data, error } = await db
            .from("lecture_posts")
            .insert(lectureData)
            .select();

        if (error) throw error;

        console.log("Lecture announcement saved successfully.");

        $("postForm").reset();

        await refreshDashboard();

        notify("Lecture announcement published.");

    } catch (error) {
        console.error("LECTURE POST ERROR:", error);

        notify(
            "Lecture error: " +
            (error.message || JSON.stringify(error))
        );
    }
});

// CANCEL LECTURE
async function cancelPost(id) {
    if (!confirm("Are you sure you want to cancel this lecture?")) {
        return;
    }

    try {
        const { error } = await db
            .from("lecture_posts")
            .update({ cancelled: true })
            .eq("id", id);

        if (error) throw error;

        await refreshDashboard();

        notify("Lecture cancelled.");

    } catch (error) {
        console.error("Cancel lecture error:", error);
        notify("Cancel lecture error: " + error.message);
    }
}

// LOG OUT
$("logoutBtn").addEventListener("click", async () => {
    try {
        const { error } = await db.auth.signOut();

        if (error) throw error;

        currentUser = null;
        profile = null;

        $("dashboard").hidden = true;
        $("authSection").hidden = false;
        $("logoutBtn").hidden = true;

        notify("You have logged out.");

    } catch (error) {
        console.error("Logout error:", error);
        notify("Logout error: " + error.message);
    }
});

// START APPLICATION
async function startApp() {
    try {
        await loadPrograms();

        const { data, error } = await db.auth.getSession();

        if (error) throw error;

        if (data.session) {
            currentUser = data.session.user;
            await showDashboard();
        }

    } catch (error) {
        console.error("Application startup error:", error);
        notify("Application error: " + error.message);
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

