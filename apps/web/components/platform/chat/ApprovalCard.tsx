'use client';

import { formatDistanceToNow } from 'date-fns';
import { ShieldAlert, ShieldCheck, Check, X, Terminal, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ApprovalRequest } from './types';

interface ApprovalCardProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onDismiss: () => void;
}

const DESTRUCTIVE_TOOLS = [
  'send_email',
  'delete',
  'update_member',
  'send_message',
  'delete_file',
  'archive_conversation',
  'kick_member',
  'cancel_subscription'
];

export function ApprovalCard({ request, onApprove, onDismiss }: ApprovalCardProps) {
  const isDestructive = DESTRUCTIVE_TOOLS.includes(request.toolName);
  const isPending = request.status === 'pending';

  if (!isPending) {
    const isApproved = request.status === 'approved';
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1 px-2 bg-muted/30 rounded-lg border border-border/20 w-fit">
        <Terminal className="h-3 w-3" />
        <span className="font-mono">{request.toolName}</span>
        <span className="mx-1">·</span>
        <span className={cn(isApproved ? "text-green-500" : "text-red-500")}>
          {isApproved ? 'approved' : 'dismissed'} by you
        </span>
        <span className="mx-1">·</span>
        <span>{request.decisionAt ? formatDistanceToNow(new Date(request.decisionAt), { addSuffix: true }) : 'just now'}</span>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card shadow-lg my-4 max-w-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "h-2 w-2 rounded-full animate-pulse",
            isDestructive ? "bg-red-500" : "bg-primary"
          )} />
          <h4 className="text-sm font-semibold">Approval needed before I continue</h4>
        </div>
        <Badge 
          variant="outline" 
          className={cn(
            "text-[10px] uppercase tracking-wider font-bold",
            isDestructive 
              ? "bg-red-500/10 text-red-500 border-red-500/20" 
              : "bg-green-500/10 text-green-500 border-green-500/20"
          )}
        >
          {isDestructive ? 'Irreversible' : 'Safe'}
        </Badge>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        <p className="text-sm text-foreground leading-relaxed">
          {request.description}
        </p>

        <div className="rounded-lg border border-border bg-muted/50 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border bg-muted flex items-center gap-2">
            <Terminal className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider font-bold">Action: {request.toolName}</span>
          </div>
          <pre className="p-3 text-xs font-mono overflow-auto max-h-40 bg-background/50 text-muted-foreground">
            {JSON.stringify(request.arguments, null, 2)}
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Agent paused</span>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-xs font-medium hover:bg-muted"
            onClick={onDismiss}
          >
            <X className="h-3 w-3 mr-1.5" />
            Dismiss
          </Button>
          <Button 
            variant={isDestructive ? "destructive" : "default"} 
            size="sm" 
            className="h-8 text-xs font-medium shadow-sm"
            onClick={onApprove}
          >
            <Check className="h-3 w-3 mr-1.5" />
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
