import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware';
import { supabase, getConversationsByBusiness, updateConversation, appendMessage } from '../db/supabase';
import { sendSms } from '../services/twilio.service';
import { buildMessageId } from '../services/ai.service';
import logger from '../utils/logger';

const router = Router();
router.use(requireAuth);

// ──────────────────────────────────────────────────────────────
// GET /conversations  — list all conversations for this business
// ──────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const page = parseInt((req.query['page'] as string) ?? '1', 10);
  const limit = Math.min(parseInt((req.query['limit'] as string) ?? '25', 10), 100);
  const offset = (page - 1) * limit;

  const conversations = await getConversationsByBusiness(business.id, limit, offset);

  // Count total
  const { count } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', business.id);

  res.json({ conversations, total: count ?? 0, page, limit });
});

// ──────────────────────────────────────────────────────────────
// GET /conversations/:id  — single conversation thread
// ──────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('business_id', business.id) // enforces tenant isolation
    .single();

  if (error || !conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.json({ conversation });
});

// ──────────────────────────────────────────────────────────────
// POST /conversations/:id/takeover  — owner takes over the chat
// ──────────────────────────────────────────────────────────────
router.post('/:id/takeover', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, business_id')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (error || !conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  await updateConversation(id, { status: 'human_takeover' });
  logger.info('Human takeover', { conversationId: id, businessId: business.id });

  res.json({ success: true, status: 'human_takeover' });
});

// ──────────────────────────────────────────────────────────────
// POST /conversations/:id/handback  — re-enable AI for conversation
// ──────────────────────────────────────────────────────────────
router.post('/:id/handback', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, business_id')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  await updateConversation(id, { status: 'active' });
  res.json({ success: true, status: 'active' });
});

// ──────────────────────────────────────────────────────────────
// POST /conversations/:id/reply  — owner sends a manual message
// ──────────────────────────────────────────────────────────────
const replySchema = z.object({
  message: z.string().min(1).max(1600),
});

router.post('/:id/reply', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('id, twilio_number')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, business_id, customer_phone, status')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Append human message to conversation history
  const humanMsg = {
    id: buildMessageId(),
    role: 'human' as const,
    content: parsed.data.message,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(id, humanMsg);

  // Send via Twilio
  await sendSms(conversation.customer_phone, business.twilio_number, parsed.data.message);

  res.json({ success: true, message: humanMsg });
});

// ──────────────────────────────────────────────────────────────
// PATCH /conversations/:id/close
// ──────────────────────────────────────────────────────────────
router.patch('/:id/close', async (req: Request, res: Response): Promise<void> => {
  const { userEmail } = req as AuthenticatedRequest;
  const { id } = req.params as { id: string };

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_email', userEmail)
    .single();

  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, business_id')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  await updateConversation(id, { status: 'closed' });
  res.json({ success: true });
});

export default router;
