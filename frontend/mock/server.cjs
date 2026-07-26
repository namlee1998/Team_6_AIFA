const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Support both /api and /api/v1 prefixes by rewriting incoming URLs
app.use((req, res, next) => {
  console.log(`[Mock Server] ${req.method} ${req.url}`);
  if (req.url.startsWith('/api/v1/')) {
    req.url = req.url.replace('/api/v1/', '/api/');
  }
  next();
});

// ── In-Memory Database State ──────────────────────────────────────────────
const projects = {
  'project-123': {
    id: 'project-123',
    name: 'Hệ thống Quản lý Bán hàng Online',
    description: 'Xây dựng website bán lẻ tích hợp thanh toán thẻ và giỏ hàng tự động.',
    released: false,
    currentPhase: 'intent',
    backlogs: [
      { id: 'b-1', title: 'Tạo trang Login sử dụng Google OAuth', description: 'Cho phép người dùng đăng nhập bằng Google.', status: 'todo', priority: 'High' },
      { id: 'b-2', title: 'Thiết kế cơ sở dữ liệu khách hàng', description: 'Đảm bảo tuân thủ các quy tắc bảo mật RLS.', status: 'in_progress', priority: 'Medium' },
      { id: 'b-3', title: 'Tích hợp cổng thanh toán Stripe', description: 'Xử lý webhook thanh toán thành công/thất bại.', status: 'review', priority: 'High' },
      { id: 'b-4', title: 'Tối ưu hiệu năng nén ảnh sản phẩm', description: 'Sử dụng WebP định dạng nén tối ưu dung lượng.', status: 'done', priority: 'Low' }
    ],
    phases: {
      intent: null,
      po: null,
      ux: null,
      dev: null,
      qa: null
    },
    auditEvents: [],
    artifacts: {}
  }
};

// Global task state to communicate with SSE streams
const activeTasks = {};

// Helper to update project phase state
function getOrCreateProject(projectId) {
  if (!projects[projectId]) {
    projects[projectId] = {
      id: projectId,
      name: `Dự án mới (#${projectId.slice(-4)})`,
      description: 'Dự án giả lập vừa khởi tạo.',
      released: false,
      currentPhase: 'intent',
      backlogs: [],
      phases: {
        intent: null,
        po: null,
        ux: null,
        dev: null,
        qa: null
      },
      auditEvents: [],
      artifacts: {}
    };
  }
  return projects[projectId];
}

// ── Auth APIs ─────────────────────────────────────────────────────────────
const makeMockSession = (email) => {
  const user = {
    id: 'mock-user-id',
    email: email || 'dev@autonomous-factory.com',
    user_metadata: {
      company_name: 'Antigravity Tech Corp',
      job_title: 'Lead Software Engineer'
    }
  };
  return {
    session: {
      access_token: 'mock-jwt-token-123456789',
      refresh_token: 'mock-refresh-token-123456789',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user
    },
    user
  };
};

app.post('/api/auth/sign-in', (req, res) => {
  const { email } = req.body;
  res.json({
    status: 'success',
    data: makeMockSession(email)
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email } = req.body;
  res.json(makeMockSession(email));
});

app.post('/api/auth/sign-up', (req, res) => {
  const { email } = req.body;
  res.json({
    status: 'success',
    data: makeMockSession(email)
  });
});

app.post('/api/auth/register', (req, res) => {
  const { email } = req.body;
  res.json(makeMockSession(email));
});

app.post('/api/auth/oauth-url', (req, res) => {
  res.json({
    status: 'success',
    data: {
      url: 'http://localhost:5173/sdlc'
    }
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({
    status: 'success',
    data: {
      user: {
        id: 'mock-user-id',
        email: 'dev@autonomous-factory.com',
        user_metadata: {
          company_name: 'Antigravity Tech Corp',
          job_title: 'Lead Software Engineer'
        }
      }
    }
  });
});

app.post('/api/auth/sign-out', (req, res) => {
  res.json({ status: 'success' });
});

app.post('/api/auth/reset-password', (req, res) => {
  res.json({ status: 'success' });
});

app.post('/api/auth/update-password', (req, res) => {
  res.json({ status: 'success' });
});

app.get('/api/profile', (req, res) => {
  res.json({
    status: 'success',
    data: {
      id: 'mock-user-id',
      email: 'dev@autonomous-factory.com',
      company_name: 'Antigravity Tech Corp',
      job_title: 'Lead Software Engineer'
    }
  });
});

app.patch('/api/profile', (req, res) => {
  res.json({
    status: 'success',
    data: {
      id: 'mock-user-id',
      email: 'dev@autonomous-factory.com',
      company_name: 'Antigravity Tech Corp',
      job_title: 'Lead Software Engineer'
    }
  });
});

// ── Quota API (Relative fallback used by frontend client) ─────────────────
app.get('/api/quota', (req, res) => {
  res.json({
    status: 'success',
    data: {
      planId: 'pro-sandbox',
      status: 'active',
      creditsUsed: 146,
      creditsTotal: 1500,
      creditsRemaining: 1354,
      periodStart: new Date().toISOString(),
      periodEnd: null,
      usage30d: {
        tokenTotal: 145920,
        creditsCharged: 146
      }
    }
  });
});

// ── Document Tree & Document Management APIs ──────────────────────────────
app.get('/api/tree', (req, res) => {
  res.json({
    status: 'success',
    data: {
      projects: Object.values(projects).map(p => ({
        project_id: p.id,
        name: p.name,
        role: 'owner',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })),
      folders: [
        {
          folder_id: 'folder-1',
          project_id: 'project-123',
          parent_id: null,
          name: 'Tài liệu Yêu cầu',
          sort_order: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ],
      documents: [
        {
          document_id: 'doc-1',
          project_id: 'project-123',
          folder_id: 'folder-1',
          file_name: 'PRD_OnlineShopping.md',
          file_type: 'markdown',
          file_size: 2048,
          status: 'processed',
          created_at: new Date().toISOString()
        }
      ]
    }
  });
});

app.get('/api/invitations/mine', (req, res) => {
  res.json({
    status: 'success',
    data: []
  });
});

app.post('/api/invitations/accept', (req, res) => {
  res.json({
    status: 'success',
    data: {
      invitation_id: req.body.invitation_id || 'inv-123',
      project_id: 'project-123',
      project_name: 'Hệ thống Quản lý Bán hàng Online',
      email: 'dev@autonomous-factory.com',
      role: 'editor',
      status: 'accepted',
      invited_by: 'system',
      expires_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }
  });
});

app.get('/api/documents', (req, res) => {
  res.json({
    status: 'success',
    data: [
      {
        document_id: 'doc-1',
        project_id: 'project-123',
        folder_id: 'folder-1',
        file_name: 'PRD_OnlineShopping.md',
        file_type: 'markdown',
        file_size: 2048,
        status: 'processed',
        created_at: new Date().toISOString()
      }
    ],
    total: 1
  });
});

app.post('/api/documents/upload', (req, res) => {
  res.json({
    status: 'success',
    data: {
      document_id: `doc-${Date.now()}`,
      file_name: 'tailieu_upload.md',
      file_type: 'markdown'
    }
  });
});

app.get('/api/documents/:id', (req, res) => {
  res.json({
    status: 'success',
    data: {
      document_id: req.params.id,
      project_id: 'project-123',
      folder_id: 'folder-1',
      file_name: 'PRD_OnlineShopping.md',
      file_type: 'markdown',
      file_size: 2048,
      status: 'processed',
      created_at: new Date().toISOString()
    }
  });
});

app.delete('/api/documents/:id', (req, res) => {
  res.json({ status: 'success' });
});

app.patch('/api/documents/:id', (req, res) => {
  res.json({
    status: 'success',
    data: {
      document_id: req.params.id,
      file_name: req.body.file_name || 'PRD_OnlineShopping.md',
      file_type: 'markdown',
      file_size: 2048,
      status: 'processed',
      created_at: new Date().toISOString()
    }
  });
});

app.patch('/api/documents/:id/move', (req, res) => {
  res.json({
    status: 'success',
    data: {
      document_id: req.params.id,
      project_id: req.body.project_id || 'project-123',
      folder_id: req.body.folder_id || 'folder-1',
      file_name: 'PRD_OnlineShopping.md',
      file_type: 'markdown',
      file_size: 2048,
      status: 'processed',
      created_at: new Date().toISOString()
    }
  });
});

app.get('/api/documents/:id/preview', (req, res) => {
  res.json({
    status: 'success',
    data: {
      url: 'https://example.com/mock-preview-url',
      file_type: 'markdown',
      file_name: 'PRD_OnlineShopping.md'
    }
  });
});

app.get('/api/documents/:id/content', (req, res) => {
  res.json({
    status: 'success',
    data: {
      content: '# Product Requirements Document (PRD)\n\n## 1. Overview\nXây dựng website bán lẻ tích hợp thanh toán thẻ và giỏ hàng tự động.\n\n## 2. Requirements\n- R1: User phải đăng nhập được qua Google OAuth.\n- R2: Cập nhật trạng thái Kanban kéo thả ngay lập tức.\n- R3: Tích hợp cổng thanh toán Stripe.',
      file_type: 'markdown',
      file_name: 'PRD_OnlineShopping.md'
    }
  });
});

app.get('/api/folders', (req, res) => {
  res.json({
    status: 'success',
    data: [
      {
        folder_id: 'folder-1',
        project_id: 'project-123',
        parent_id: null,
        name: 'Tài liệu Yêu cầu',
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]
  });
});

app.post('/api/folders', (req, res) => {
  res.json({
    status: 'success',
    data: {
      folder_id: `folder-${Date.now()}`,
      project_id: req.body.project_id || 'project-123',
      parent_id: req.body.parent_id || null,
      name: req.body.name || 'Thư mục mới',
      sort_order: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  });
});

app.patch('/api/folders/:id', (req, res) => {
  res.json({
    status: 'success',
    data: {
      folder_id: req.params.id,
      project_id: 'project-123',
      parent_id: null,
      name: req.body.name || 'Thư mục mới',
      sort_order: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  });
});

app.patch('/api/folders/:id/move', (req, res) => {
  res.json({
    status: 'success',
    data: {
      folder_id: req.params.id,
      project_id: req.body.project_id || 'project-123',
      parent_id: req.body.parent_id || null,
      name: 'Thư mục mới',
      sort_order: req.body.sort_order || 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  });
});

app.delete('/api/folders/:id', (req, res) => {
  res.json({ status: 'success' });
});

// ── Session State & Workflow APIs ─────────────────────────────────────────
app.delete('/api/sessions/:page', (req, res) => {
  res.json({ status: 'success' });
});

app.post('/api/sessions/:page', (req, res) => {
  res.json({
    status: 'success',
    data: {
      id: 'session-123',
      page: req.params.page,
      selectedDocIds: [],
      taskId: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/sessions/:page', (req, res) => {
  res.json({
    status: 'success',
    data: null
  });
});

app.get('/api/workflows/tasks', (req, res) => {
  res.json({
    status: 'success',
    data: []
  });
});

app.get('/api/workflows/latest/:documentId', (req, res) => {
  res.json({
    status: 'success',
    data: null
  });
});

app.get('/api/workflows/status/:taskId', (req, res) => {
  res.json({
    status: 'success',
    data: null
  });
});

app.get('/api/projects/:projectId/members', (req, res) => {
  res.json({
    status: 'success',
    data: []
  });
});

app.get('/api/projects/:projectId/invitations', (req, res) => {
  res.json({
    status: 'success',
    data: []
  });
});


// ── Project Management APIs ───────────────────────────────────────────────
app.get('/api/projects', (req, res) => {
  const list = Object.values(projects).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description
  }));
  res.json({ status: 'success', data: list });
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  const id = `project-${Date.now()}`;
  projects[id] = {
    id,
    name: name || 'Dự án mới',
    description: description || '',
    released: false,
    currentPhase: 'intent',
    backlogs: [],
    phases: {
      intent: null,
      po: null,
      ux: null,
      dev: null,
      qa: null
    },
    auditEvents: [],
    artifacts: {}
  };
  res.json({ status: 'success', data: projects[id] });
});

// ── Kanban & Backlog APIs ──────────────────────────────────────────────────
app.get('/api/sdlc/projects/:projectId/backlog', (req, res) => {
  const p = getOrCreateProject(req.params.projectId);
  res.json({ status: 'success', data: p.backlogs });
});

app.post('/api/sdlc/projects/:projectId/backlog', (req, res) => {
  const p = getOrCreateProject(req.params.projectId);
  const item = {
    id: `b-${Date.now()}`,
    title: req.body.title || 'Backlog mới',
    description: req.body.description || '',
    status: 'todo',
    priority: req.body.priority || 'Medium'
  };
  p.backlogs.push(item);
  res.json({ status: 'success', data: item });
});

app.patch('/api/sdlc/backlog/:backlogId/move', (req, res) => {
  const { backlogId } = req.params;
  const { status } = req.body;
  let found = null;
  for (const p of Object.values(projects)) {
    const item = p.backlogs.find(b => b.id === backlogId);
    if (item) {
      item.status = status;
      found = item;
      break;
    }
  }
  if (found) {
    res.json({ status: 'success', data: found });
  } else {
    res.status(404).json({ status: 'error', message: 'Backlog item not found' });
  }
});

// ── SDLC Dashboard APIs ────────────────────────────────────────────────────
app.get('/api/sdlc/workflow-status', (req, res) => {
  const projectId = req.query.project_id || 'project-123';
  const p = getOrCreateProject(projectId);
  res.json({
    status: 'success',
    data: {
      projectId: p.id,
      currentPhase: p.currentPhase,
      phases: p.phases
    }
  });
});

app.get('/api/sdlc/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = activeTasks[taskId] || {
    id: taskId,
    status: 'completed',
    artifacts: []
  };
  res.json({ status: 'success', data: task });
});

app.post('/api/sdlc/tasks/:taskId/gate-decision', (req, res) => {
  const { taskId } = req.params;
  const { decision, comment } = req.body;

  // Find which project and phase this task belongs to
  let foundProject = null;
  let foundPhaseKey = null;

  for (const p of Object.values(projects)) {
    for (const [key, value] of Object.entries(p.phases)) {
      if (value && value.taskId === taskId) {
        foundProject = p;
        foundPhaseKey = key;
        break;
      }
    }
  }

  if (foundProject && foundPhaseKey) {
    const phaseInfo = foundProject.phases[foundPhaseKey];
    phaseInfo.hitlDecision = {
      decision,
      comment: comment || '',
      reviewer_name: 'Human Gatekeeper',
      timestamp: new Date().toISOString()
    };

    // Log to audit events
    const gateNames = {
      intent: 'REQUIREMENT_GATE',
      po: 'REQUIREMENT_GATE',
      ux: 'UX_GATE',
      dev: 'DEV_GATE',
      qa: 'QA_GATE'
    };

    foundProject.auditEvents.unshift({
      id: `audit-${Date.now()}`,
      phase: foundPhaseKey,
      gate: gateNames[foundPhaseKey] || 'QUALITY_GATE',
      decision,
      comment: comment || '',
      reviewer_name: 'Human Gatekeeper',
      artifact_version: phaseInfo.artifact_version || '1.0.0',
      timestamp: new Date().toISOString()
    });

    if (decision === 'APPROVE') {
      // Unlock next phase
      const flow = ['intent', 'po', 'ux', 'dev', 'qa'];
      const nextIdx = flow.indexOf(foundPhaseKey) + 1;
      if (nextIdx < flow.length) {
        foundProject.currentPhase = flow[nextIdx];
      } else {
        foundProject.currentPhase = 'FINAL_REVIEW';
      }
    } else {
      // Rework: keep current phase unlocked but require rerun
      phaseInfo.status = 'failed';
    }

    res.json({ status: 'success', message: 'Gate decision recorded' });
  } else {
    res.status(404).json({ status: 'error', message: 'Task not associated with any active project' });
  }
});

// Run Agent Triggers
const runAgentHandler = (phaseKey) => (req, res) => {
  const projectId = req.body.project_id || 'project-123';
  const p = getOrCreateProject(projectId);
  const taskId = `task-${phaseKey}-${Date.now().toString().slice(-4)}`;

  p.phases[phaseKey] = {
    status: 'processing',
    taskId,
    updatedAt: new Date().toISOString(),
    hitlDecision: null,
    phase: phaseKey,
    artifact_version: '1.0.0'
  };
  p.currentPhase = phaseKey;

  activeTasks[taskId] = {
    id: taskId,
    projectId: p.id,
    phase: phaseKey,
    status: 'processing',
    artifacts: []
  };

  res.json({ status: 'success', task_id: taskId });
};

app.post('/api/sdlc/run-intent-agent', runAgentHandler('intent'));
app.post('/api/sdlc/run-po-agent', runAgentHandler('po'));
app.post('/api/sdlc/run-ux-agent', (req, res) => {
  // UX triggers via source task id, find matching project
  const projectId = 'project-123'; 
  req.body.project_id = projectId;
  runAgentHandler('ux')(req, res);
});
app.post('/api/sdlc/run-dev-agent', (req, res) => {
  const projectId = 'project-123'; 
  req.body.project_id = projectId;
  runAgentHandler('dev')(req, res);
});
app.post('/api/sdlc/run-qa-agent', (req, res) => {
  const projectId = 'project-123'; 
  req.body.project_id = projectId;
  runAgentHandler('qa')(req, res);
});

// ── SSE Event Stream ───────────────────────────────────────────────────────
app.get('/api/sdlc/status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = activeTasks[taskId];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!task) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Task not found' })}\n\n`);
    res.end();
    return;
  }

  const logs = {
    intent: [
      '🧠 [Intent Agent] Khởi động Intent Parser...',
      '🔍 [Intent Agent] Đang phân tích nội dung yêu cầu người dùng...',
      '🛠️ [Intent Agent] Đang phân tích ranh giới kỹ thuật & độ ưu tiên...',
      '✅ [Intent Agent] Phân tích hoàn tất. Đang soạn thảo đặc tả yêu cầu...'
    ],
    po: [
      '📋 [PO Agent] Đang đọc đặc tả yêu cầu (Intent Spec)...',
      '✍️ [PO Agent] Đang xây dựng tài liệu PRD (Product Requirements Document)...',
      '⚙️ [PO Agent] Đang định nghĩa kịch bản người dùng (User Stories)...',
      '✅ [PO Agent] Hoàn thành PRD. Đang lưu trữ...'
    ],
    ux: [
      '🎨 [UX Agent] Đang phân tích luồng người dùng từ PRD...',
      '🖌️ [UX Agent] Khởi tạo khung lưới thiết kế dây điện (Wireframes)...',
      '🔗 [UX Agent] Đang liên kết bản thiết kế tới Penpot workspace...',
      '✅ [UX Agent] Thiết lập thiết kế hoàn tất. Sẵn sàng xem trước...'
    ],
    dev: [
      '⚙️ [DEV Agent] Đọc tài liệu thiết kế và PRD...',
      '💾 [DEV Agent] Khởi tạo tệp cấu hình Database & RLS policies...',
      '💻 [DEV Agent] Đang viết mã nguồn React Components & Styles...',
      '✅ [DEV Agent] Biên dịch mã nguồn thành công. Đang đóng gói...'
    ],
    qa: [
      '🧪 [QA Agent] Đọc mã nguồn và tài liệu kiểm thử...',
      '📝 [QA Agent] Tự động tạo mã nguồn test cases cho Vitest/Playwright...',
      '🚀 [QA Agent] Đang chạy kiểm thử đo lường độ phủ sóng (Coverage)...',
      '✅ [QA Agent] Tất cả test cases pass 100%. Báo cáo hoàn tất...'
    ]
  };

  const phaseLogs = logs[task.phase] || ['🚀 Khởi chạy Agent...'];
  let currentLogIdx = 0;

  const timer = setInterval(() => {
    if (currentLogIdx < phaseLogs.length) {
      res.write(`event: progress\ndata: ${JSON.stringify({ log: phaseLogs[currentLogIdx] })}\n\n`);
      currentLogIdx++;
    } else {
      clearInterval(timer);
      
      // Update state to completed
      task.status = 'completed';
      const p = projects[task.projectId];
      if (p) {
        p.phases[task.phase].status = 'completed';
        p.phases[task.phase].updatedAt = new Date().toISOString();
      }

      // Generate dummy artifacts
      let artifacts = [];
      if (task.phase === 'intent') {
        artifacts = [
          { name: 'intent_specification.json', path: '/intent_specification.json', content: JSON.stringify({ title: p.name, features: p.backlogs }, null, 2) },
          { name: 'spec_intent.md', path: '/spec_intent.md', content: `# Intent Specification\n\n- Project ID: ${p.id}\n- Goal: ${p.description}\n\n*Generated by Intent Agent*` }
        ];
      } else if (task.phase === 'po') {
        artifacts = [
          { name: 'prd_document.md', path: '/prd_document.md', content: `# Product Requirements Document (PRD)\n\n## 1. Overview\n${p.description}\n\n## 2. Requirements\n- R1: User must login via OAuth\n- R2: Kanban drags must update immediately.` }
        ];
      } else if (task.phase === 'ux') {
        artifacts = [
          { name: 'ux_wireframe_spec.json', path: '/ux_wireframe_spec.json', content: JSON.stringify({ screens: 4, workspace: 'penpot-mock-id-999' }, null, 2) },
          { name: 'ux_spec.md', path: '/ux_spec.md', content: `# UX Design Specification\n\nHere is the Penpot prototype link:\n[Penpot Workspace](https://design.penpot.app/#/view/mock-workspace)\n\n### Screen Flow:\n1. Login screen\n2. Kanbanboard view\n3. Pipeline monitor\n4. Profile drawer` }
        ];
      } else if (task.phase === 'dev') {
        artifacts = [
          { name: 'schema.sql', path: '/schema.sql', content: 'CREATE TABLE backlogs (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  title TEXT NOT NULL,\n  status TEXT DEFAULT \'todo\'\n);' },
          { name: 'KanbanBoard.tsx', path: '/KanbanBoard.tsx', content: 'export default function KanbanBoard() {\n  return <div>Kanban Board</div>;\n}' }
        ];
      } else if (task.phase === 'qa') {
        artifacts = [
          { name: 'test_plan.md', path: '/test_plan.md', content: '# QA Test Plan\n\n- [x] Test Kanban renders correctly\n- [x] Test OAuth flows\n- [x] Test SSE channels reconnection' },
          { name: 'KanbanBoard.test.tsx', path: '/KanbanBoard.test.tsx', content: 'test("renders board", () => {\n  render(<KanbanBoard />);\n  expect(screen.getByText("todo")).toBeInTheDocument();\n});' }
        ];
      }

      task.artifacts = artifacts;
      p.artifacts[taskId] = artifacts;

      res.write(`event: completed\ndata: ${JSON.stringify({ status: 'completed', artifacts })}\n\n`);
      res.end();
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(timer);
  });
});

// ── Final Release & Release APIs ──────────────────────────────────────────
app.get('/api/sdlc/final-review-packet/:projectId', (req, res) => {
  const { projectId } = req.params;
  const p = getOrCreateProject(projectId);
  res.json({
    status: 'success',
    data: {
      phases: {
        intent: { taskId: 'task-intent-123', status: 'completed', versionStatus: 'committed' },
        po: { taskId: 'task-po-123', status: 'completed', versionStatus: 'committed' },
        ux: { taskId: 'task-ux-123', status: 'completed', versionStatus: 'committed' },
        dev: { taskId: 'task-dev-123', status: 'completed', versionStatus: 'committed' },
        qa: { taskId: 'task-qa-123', status: 'completed', versionStatus: 'completed' }
      },
      artifacts: [
        {
          id: 'art-intent',
          phase: 'po-agent',
          type: 'prd',
          title: 'Product Requirements Document (PRD)',
          contentText: '# Product Requirements Document (PRD)\n\n## 1. Overview\nXây dựng website bán lẻ tích hợp thanh toán thẻ và giỏ hàng tự động.\n\n## 2. Requirements\n- R1: User phải đăng nhập được qua Google OAuth.\n- R2: Cập nhật trạng thái Kanban kéo thả ngay lập tức.\n- R3: Tích hợp Stripe.',
          contentJson: null
        },
        {
          id: 'art-ux',
          phase: 'ux-agent',
          type: 'ux_spec',
          title: 'UX/UI Wireframe Spec',
          contentText: '# UX/UI Spec\n\nPenpot screens resolved.',
          contentJson: null
        },
        {
          id: 'art-dev',
          phase: 'dev-agent',
          type: 'implementation_plan',
          title: 'Implementation Plan',
          contentText: '# DEV Plan\n\n- [x] Setup database schemas\n- [x] Configure router and controllers',
          contentJson: null
        },
        {
          id: 'art-qa',
          phase: 'qa-agent',
          type: 'test_cases',
          title: 'Vitest Unit Test Cases',
          contentText: '# QA Testcases\n\n- [x] test("renders KanbanBoard")',
          contentJson: null
        }
      ],
      hitlDecisions: [
        {
          id: 'hitl-1',
          gate: 'REQUIREMENT_GATE',
          decision: 'APPROVE',
          comment: 'Yêu cầu được phân tích rất rõ ràng, đồng ý thông qua.',
          createdAt: new Date().toISOString()
        },
        {
          id: 'hitl-2',
          gate: 'UX_GATE',
          decision: 'APPROVE',
          comment: 'Wireframe thiết kế Penpot trực quan, bố cục tốt.',
          createdAt: new Date().toISOString()
        },
        {
          id: 'hitl-3',
          gate: 'DEV_GATE',
          decision: 'APPROVE',
          comment: 'Mã nguồn viết sạch sẽ, tuân thủ quy tắc bảo mật.',
          createdAt: new Date().toISOString()
        }
      ],
      generatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/sdlc/audit-trail/:projectId', (req, res) => {
  const { projectId } = req.params;
  const p = getOrCreateProject(projectId);
  res.json({
    status: 'success',
    data: {
      events: p.auditEvents
    }
  });
});

app.post('/api/sdlc/release/:projectId', (req, res) => {
  const { projectId } = req.params;
  const p = getOrCreateProject(projectId);
  p.released = true;
  p.currentPhase = 'RELEASED';
  res.json({
    status: 'success',
    message: 'Triển khai gói phát hành thành công.'
  });
});

// ── Start Server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Node Express Mock Server running on http://localhost:${PORT}`);
  console.log('💡 Proxied directly via Vite Dev Server. No client config changes needed.');
});
