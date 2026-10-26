import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { supabase } from "./supabase";
import Sidebar from "./components/Sidebar";
import Login from "./components/Login";
import "./App.css";

// Code-split the heavy views so the initial load only downloads the one in use
// (Tasks.jsx alone is ~8k lines). Each becomes its own chunk, lazy-loaded.
const Dashboard = lazy(() => import("./components/Dashboard"));
const Tasks = lazy(() => import("./components/Tasks"));
const Wiki = lazy(() => import("./components/Wiki"));
const WhiteboardView = lazy(() => import("./components/Whiteboard"));
const Settings = lazy(() => import("./components/Settings"));
const MyTasks = lazy(() => import("./components/MyTasks"));
const Quotations = lazy(() => import("./components/Quotations"));

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState(
    () => localStorage.getItem("abc_view") || "dashboard",
  );
  const [activeSpace, setActiveSpace] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeList, setActiveList] = useState(null);
  const [openArticleId, setOpenArticleId] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [activeWhiteboard, setActiveWhiteboard] = useState(null);
  const [newDocFolderId, setNewDocFolderId] = useState(null);
  const [newDocSpaceId, setNewDocSpaceId] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [pendingSpaceId, setPendingSpaceId] = useState(
    () => localStorage.getItem("abc_space_id") || null,
  );
  const [pendingFolderId, setPendingFolderId] = useState(
    () => localStorage.getItem("abc_folder_id") || null,
  );
  const [pendingListId, setPendingListId] = useState(
    () => localStorage.getItem("abc_list_id") || null,
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem("abc_sidebar_width") || "240");
  });
  const isSidebarResizing = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) fetchSpaces();
  }, [user]);

  // Restore active space and folder after spaces are loaded
  useEffect(() => {
    if (spaces.length === 0) return;
    if (pendingSpaceId) {
      const space = spaces.find((s) => s.id === pendingSpaceId);
      if (space) {
        setActiveSpace(space);
        if (pendingFolderId) {
          const folder = space.folders?.find((f) => f.id === pendingFolderId);
          if (folder) setActiveFolder(folder);
        }
        // Lists live in their own table (not the spaces tree), so fetch the
        // remembered list by id to land back on the exact list after a refresh.
        if (pendingListId) {
          supabase
            .from("lists")
            .select("*")
            .eq("id", pendingListId)
            .is("deleted_at", null)
            .single()
            .then(({ data: list }) => { if (list) setActiveList(list); });
        }
      }
      setPendingSpaceId(null);
      setPendingFolderId(null);
      setPendingListId(null);
    }
  }, [spaces]);

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data);
  }

  async function fetchSpaces() {
    // Exclude soft-deleted spaces and folders so trashed items disappear
    // from the sidebar immediately, without waiting for a hard delete.
    const { data, error } = await supabase
      .from("spaces")
      .select(
        `
      *,
      space_statuses(*),
      space_fields(*),
      folders!folders_space_id_fkey(
        *,
        space_statuses(*),
        space_fields(*)
      )
    `,
      )
      .is("deleted_at", null)
      .order("created_at");

    if (data) {
      // Also filter out any soft-deleted folders that came through the
      // nested select (belt-and-braces in case the FK filter above doesn't
      // apply server-side depending on your Postgres/PostgREST version).
      // Order by sort_order client-side (falls back to created_at) so a
      // missing sort_order column can never break loading.
      const byOrder = (a, b) =>
        (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) ||
        new Date(a.created_at) - new Date(b.created_at);
      const cleaned = data
        .map((space) => ({
          ...space,
          folders: (space.folders || []).filter((f) => !f.deleted_at).sort(byOrder),
        }))
        .sort(byOrder);
      setSpaces(cleaned);
      if (activeSpace) {
        const updated = cleaned.find((s) => s.id === activeSpace.id);
        if (updated) setActiveSpace(updated);
        else {
          // The active space was just trashed — back out to dashboard
          setActiveSpace(null);
          setActiveFolder(null);
        }
      }
      if (activeFolder) {
        const stillExists = cleaned
          .find((s) => s.id === activeSpace?.id)
          ?.folders?.find((f) => f.id === activeFolder.id);
        if (!stillExists) setActiveFolder(null);
      }
    }
  }

  const [taskCounts, setTaskCounts] = useState({});
  const [accessRules, setAccessRules] = useState({
    restrictedSpaces: new Set(), allowedSpaces: new Set(),
    restrictedFolders: new Set(), allowedFolders: new Set(),
  });

  useEffect(() => {
    if (user) fetchTaskCounts();
  }, [user, spaces]);

  // Keep the sidebar task counts live: any task insert/update/delete (from this
  // user or anyone else — new task, move between lists, trash, restore) refreshes
  // the counts without a page reload. Debounced so a burst of changes (e.g. a CSV
  // import) triggers a single refetch.
  const countsRefreshTimer = useRef(null);
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      clearTimeout(countsRefreshTimer.current);
      countsRefreshTimer.current = setTimeout(() => fetchTaskCounts(), 400);
    };
    const channel = supabase
      .channel("sidebar-task-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(countsRefreshTimer.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, spaces]);

  useEffect(() => {
    if (profile && profile.role !== "admin") fetchAccessRules(profile);
    else if (profile?.role === "admin") setAccessRules({ restrictedSpaces: new Set(), allowedSpaces: new Set(), restrictedFolders: new Set(), allowedFolders: new Set() });
  }, [profile?.id]);

  async function fetchAccessRules(currentProfile) {
    const [{ data: spaceRules }, { data: folderRules }] = await Promise.all([
      supabase.from("space_access").select("space_id, profile_id"),
      supabase.from("folder_access").select("folder_id, profile_id"),
    ]);
    const pid = currentProfile?.id;
    setAccessRules({
      restrictedSpaces: new Set((spaceRules || []).map((r) => r.space_id)),
      allowedSpaces: new Set((spaceRules || []).filter((r) => r.profile_id === pid).map((r) => r.space_id)),
      restrictedFolders: new Set((folderRules || []).map((r) => r.folder_id)),
      allowedFolders: new Set((folderRules || []).filter((r) => r.profile_id === pid).map((r) => r.folder_id)),
    });
  }

  async function fetchTaskCounts() {
    if (!spaces.length) return;
    // Single RPC returns list / folder-direct / space-direct counts, replacing
    // ~60 per-scope COUNT round-trips. Roll up list → folder → space client-side.
    const { data, error } = await supabase.rpc("task_counts");
    if (error || !data) return;
    const counts = {};
    (data.lists || []).forEach(({ id, folder_id, space_id, count }) => {
      if (!count) return;
      counts[id] = (counts[id] || 0) + count;
      if (folder_id) counts[folder_id] = (counts[folder_id] || 0) + count;
      if (space_id) counts[space_id] = (counts[space_id] || 0) + count;
    });
    (data.folders || []).forEach(({ id, space_id, count }) => {
      if (!count) return;
      counts[id] = (counts[id] || 0) + count;
      if (space_id) counts[space_id] = (counts[space_id] || 0) + count;
    });
    (data.spaces || []).forEach(({ id, count }) => {
      if (count) counts[id] = (counts[id] || 0) + count;
    });
    setTaskCounts(counts);
  }

  function startSidebarResize(e) {
    isSidebarResizing.current = true;
    document.addEventListener("mousemove", onSidebarMouseMove);
    document.addEventListener("mouseup", stopSidebarResize);
    e.preventDefault();
  }

  function onSidebarMouseMove(e) {
    if (!isSidebarResizing.current) return;
    const newWidth = e.clientX;
    if (newWidth >= 180 && newWidth <= 400) {
      setSidebarWidth(newWidth);
      localStorage.setItem("abc_sidebar_width", newWidth);
    }
  }

  function stopSidebarResize() {
    isSidebarResizing.current = false;
    document.removeEventListener("mousemove", onSidebarMouseMove);
    document.removeEventListener("mouseup", stopSidebarResize);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    localStorage.removeItem("abc_view");
    localStorage.removeItem("abc_space_id");
    localStorage.removeItem("abc_folder_id");
    localStorage.removeItem("abc_list_id");
    setUser(null);
    setProfile(null);
    setView("dashboard");
    setActiveSpace(null);
    setActiveFolder(null);
  }

  function handleSpaceSelect(space) {
    setActiveSpace(space);
    setActiveFolder(null);
    setActiveList(null);
    setView("tasks");
    localStorage.setItem("abc_view", "tasks");
    localStorage.setItem("abc_space_id", space.id);
    localStorage.removeItem("abc_folder_id");
    localStorage.removeItem("abc_list_id");
  }

  function handleFolderSelect(space, folder) {
    setActiveSpace(space);
    setActiveFolder(folder);
    setActiveList(null);
    setView("tasks");
    localStorage.setItem("abc_view", "tasks");
    localStorage.setItem("abc_space_id", space.id);
    localStorage.setItem("abc_folder_id", folder.id);
    localStorage.removeItem("abc_list_id");
  }

  function handleListSelect(space, folder, list) {
    setActiveSpace(space);
    setActiveFolder(folder);
    setActiveList(list);
    setView("tasks");
    localStorage.setItem("abc_view", "tasks");
    localStorage.setItem("abc_space_id", space.id);
    localStorage.setItem("abc_folder_id", folder.id);
    localStorage.setItem("abc_list_id", list.id);
  }

  // Open a task from a notification: navigate to its space/folder/list, then
  // open its drawer in Tasks.
  async function handleOpenTaskFromNotification(n) {
    const scope = n?.link_scope || {};
    const space = spaces.find((s) => s.id === scope.space_id) || null;
    const folder = space?.folders?.find((f) => f.id === scope.folder_id) || null;
    if (space) setActiveSpace(space);
    setActiveFolder(folder);
    if (scope.list_id) {
      const { data: list } = await supabase.from("lists").select("*").eq("id", scope.list_id).single();
      setActiveList(list || { id: scope.list_id, folder_id: scope.folder_id, space_id: scope.space_id });
    } else {
      setActiveList(null);
    }
    setView("tasks");
    if (n?.task_id) setOpenTaskId(n.task_id);
  }

  function handleNavigate(v) {
    if (typeof v === "string" && v.startsWith("wiki:")) {
      const articleId = v.slice(5);
      setOpenArticleId(articleId);
      setNewDocFolderId(null);
      setActiveWhiteboard(null);
      setView("wiki");
      localStorage.setItem("abc_view", "wiki");
      setActiveSpace(null);
      setActiveFolder(null);
      return;
    }
    // "doc-new:folderId:spaceId" — open Wiki in create mode linked to folder
    if (typeof v === "string" && v.startsWith("doc-new:")) {
      const [, fid, sid] = v.split(":");
      setNewDocFolderId(fid);
      setNewDocSpaceId(sid);
      setOpenArticleId(null);
      setActiveWhiteboard(null);
      setView("wiki");
      localStorage.setItem("abc_view", "wiki");
      setActiveSpace(null);
      setActiveFolder(null);
      return;
    }
    setOpenArticleId(null);
    setNewDocFolderId(null);
    setActiveWhiteboard(null);
    setView(v);
    localStorage.setItem("abc_view", v);
    if (v !== "tasks") {
      localStorage.removeItem("abc_space_id");
      localStorage.removeItem("abc_folder_id");
      localStorage.removeItem("abc_list_id");
      setActiveSpace(null);
      setActiveFolder(null);
      setActiveList(null);
    }
  }

  function handleWhiteboardSelect(wb) {
    setActiveWhiteboard(wb);
    setView("whiteboard");
    setActiveSpace(null);
    setActiveFolder(null);
    setActiveList(null);
    setOpenArticleId(null);
    setNewDocFolderId(null);
  }

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f4",
        }}
      >
        <div style={{ fontSize: 14, color: "#888" }}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="app-layout">
      <Sidebar
        spaces={spaces}
        activeSpace={activeSpace}
        activeFolder={activeFolder}
        activeList={activeList}
        activeWhiteboard={activeWhiteboard}
        view={view}
        profile={profile}
        onNavigate={handleNavigate}
        onSpaceSelect={handleSpaceSelect}
        onFolderSelect={handleFolderSelect}
        onListSelect={handleListSelect}
        onWhiteboardSelect={handleWhiteboardSelect}
        taskCounts={taskCounts}
        onRefreshTaskCounts={fetchTaskCounts}
        accessRules={accessRules}
        onSpaceCreated={fetchSpaces}
        onLogout={handleLogout}
        onOpenTask={handleOpenTaskFromNotification}
        width={sidebarWidth}
      />
      {/* Resize handle */}
      <div
        onMouseDown={startSidebarResize}
        style={{
          width: 4,
          flexShrink: 0,
          background: "transparent",
          cursor: "col-resize",
          transition: "background 0.15s",
          zIndex: 10,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#b3e3e1")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        title="Drag to resize sidebar"
      />
      <main className="app-main">
        <Suspense fallback={<div style={{ padding: 24, fontSize: 13, color: "#9ca3af" }}>Loading…</div>}>
        {view === "dashboard" && (
          <Dashboard
            spaces={spaces}
            profile={profile}
            onNavigate={handleNavigate}
            onSpaceSelect={handleSpaceSelect}
            onOpenScope={(scope, taskId) => handleOpenTaskFromNotification({ link_scope: scope, task_id: taskId || null })}
          />
        )}
        {view === "tasks" && (
          <Tasks
            spaces={spaces}
            activeSpace={activeSpace}
            activeFolder={activeFolder}
            activeList={activeList}
            profile={profile}
            onRefreshSpaces={fetchSpaces}
            openTaskId={openTaskId}
            onTaskOpened={() => setOpenTaskId(null)}
            onOpenScope={(scope, taskId) => handleOpenTaskFromNotification({ link_scope: scope, task_id: taskId || null })}
          />
        )}
        {view === "wiki" && (
          <Wiki
            profile={profile}
            openArticleId={openArticleId}
            newDocFolderId={newDocFolderId}
            newDocSpaceId={newDocSpaceId}
            spaces={spaces}
            onDocCreated={() => { setNewDocFolderId(null); setNewDocSpaceId(null); }}
            onOpenTask={(scope) => handleOpenTaskFromNotification({
              link_scope: { space_id: scope.space_id, folder_id: scope.folder_id, list_id: scope.list_id },
              task_id: scope.task_id,
            })}
          />
        )}
        {view === "whiteboard" && activeWhiteboard && (
          <WhiteboardView
            whiteboard={activeWhiteboard}
            profile={profile}
            onBack={() => { setView("tasks"); setActiveWhiteboard(null); }}
          />
        )}
        {view === "mytasks" && <MyTasks profile={profile} />}
        {view === "quotations" && <Quotations profile={profile} />}
        {view === "settings" && profile?.role === "admin" && (
          <Settings currentUser={user} profile={profile} spaces={spaces} onAccessChanged={() => fetchAccessRules(profile)} />
        )}
        </Suspense>
      </main>
    </div>
  );
}
