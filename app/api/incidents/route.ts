import { NextRequest, NextResponse } from 'next/server';
import { requireAdminFromDb } from '@/app/lib/route-guards';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const getDataPath = () => {
  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'incidents.json');
};

const readIncidents = (): any[] => {
  const filePath = getDataPath();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to read incidents file:', e);
    return [];
  }
};

const writeIncidents = (data: any[]) => {
  const filePath = getDataPath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// ── GET: Read all incidents ─────────────────────────────────────────────────
export async function GET() {
  try {
    const list = readIncidents();
    return NextResponse.json({ success: true, incidents: list });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to retrieve incidents' }, { status: 500 });
  }
}

// ── POST: Administrative Incident Operations ─────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const adminResult = await requireAdminFromDb();
    if ('error' in adminResult) return adminResult.error;

    const body = await request.json();
    const { action, incidentId, title, severity, updateTitle, updateType, updateMessage } = body;

    const list = readIncidents();

    if (action === 'CREATE') {
      if (!title || !severity || !updateMessage) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      const now = new Date();
      const formattedDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const formattedTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';

      const newIncident = {
        id: `inc-${Date.now()}`,
        title,
        date: formattedDate,
        severity,
        updates: [
          {
            title: updateTitle || 'Incident Opened',
            time: formattedTime,
            type: updateType || 'investigating',
            message: updateMessage
          }
        ]
      };

      list.unshift(newIncident); // Add to top of the history feed
      writeIncidents(list);
      return NextResponse.json({ success: true, incident: newIncident });
    }

    if (action === 'ADD_UPDATE') {
      if (!incidentId || !updateMessage) {
        return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
      }

      const idx = list.findIndex((inc) => inc.id === incidentId);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: 'Incident not found' }, { status: 404 });
      }

      const now = new Date();
      const formattedTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';

      const newUpdate = {
        title: updateTitle || 'Status Update',
        time: formattedTime,
        type: updateType || 'monitoring',
        message: updateMessage
      };

      list[idx].updates.unshift(newUpdate); // Newest update at the top of the details log

      // If updating severity as well
      if (severity) {
        list[idx].severity = severity;
      }

      writeIncidents(list);
      return NextResponse.json({ success: true, incident: list[idx] });
    }

    if (action === 'DELETE') {
      if (!incidentId) {
        return NextResponse.json({ success: false, error: 'Missing incidentId' }, { status: 400 });
      }

      const filtered = list.filter((inc) => inc.id !== incidentId);
      writeIncidents(filtered);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[/api/incidents] POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
