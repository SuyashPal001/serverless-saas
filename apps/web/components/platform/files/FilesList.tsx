"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { EmptyState, ConfirmDialog } from "@/components/platform/shared";
import { 
    Loader2, FolderOpen, FileText, Image as ImageIcon, Video, Music, FileCode, File, Download, Trash2, Folder as FolderIcon, ChevronRight
} from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface FilesListProps {
    prefix: string;
    onPrefixChange: (prefix: string) => void;
    onUploadClick: () => void;
    canUpload: boolean;
    canDelete: boolean;
}

interface FileRecord {
    id: string;
    tenantId: string;
    key: string;
    filename: string;
    contentType: string;
    size: number;
    uploadedBy: string;
    createdAt: string;
    updatedAt: string;
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const getFileIcon = (contentType: string) => {
    if (contentType.includes('pdf')) return <FileText className="w-5 h-5 text-zinc-400" />;
    if (contentType.includes('image')) return <ImageIcon className="w-5 h-5 text-zinc-400" />;
    if (contentType.includes('video')) return <Video className="w-5 h-5 text-zinc-400" />;
    if (contentType.includes('audio')) return <Music className="w-5 h-5 text-zinc-400" />;
    if (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) return <FileCode className="w-5 h-5 text-zinc-400" />;
    return <File className="w-5 h-5 text-zinc-400" />;
};

export function FilesList({ prefix, onPrefixChange, onUploadClick, canUpload, canDelete }: FilesListProps) {
    const queryClient = useQueryClient();
    const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

    const { data: response, isLoading } = useQuery({
        queryKey: ['files', prefix],
        queryFn: async () => {
            const params = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
            return api.get<{ data: FileRecord[] }>(`/api/v1/files${params}`);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (fileId: string) => {
            return api.del(`/api/v1/files/${fileId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            toast.success("File deleted successfully");
            setDeletingFileId(null);
        },
        onError: () => {
            toast.error("Failed to delete file");
            setDeletingFileId(null);
        }
    });

    const downloadFile = async (fileId: string) => {
        try {
            const res = await api.get<{ data: { downloadUrl: string } }>(`/api/v1/files/${fileId}/download`);
            window.open(res.data.downloadUrl, '_blank');
        } catch (error) {
            toast.error("Failed to get download URL");
        }
    };

    const breadcrumbs = useMemo(() => {
        if (!prefix) return [];
        const parts = prefix.split('/').filter(Boolean);
        return parts.map((part, index) => ({
            name: part,
            path: parts.slice(0, index + 1).join('/') + '/'
        }));
    }, [prefix]);

    // Folder Detection Logic
    const { virtualFolders, files } = useMemo(() => {
        const allFiles = response?.data || [];
        const folders = new Set<string>();
        const directFiles: FileRecord[] = [];

        allFiles.forEach(file => {
            const relativePath = prefix ? file.key.substring(prefix.length) : file.key;
            
            if (relativePath.includes('/')) {
                const folderName = relativePath.split('/')[0];
                folders.add(folderName);
            } else {
                directFiles.push(file);
            }
        });

        return {
            virtualFolders: Array.from(folders).sort(),
            files: directFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        };
    }, [response?.data, prefix]);

    return (
        <div className="space-y-4">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center text-sm text-zinc-400 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800">
                <button 
                    onClick={() => onPrefixChange("")} 
                    className={`hover:text-zinc-200 transition-colors ${!prefix ? 'text-zinc-200 font-medium' : ''}`}
                >
                    Files
                </button>
                {breadcrumbs.map((crumb, idx) => (
                    <div key={crumb.path} className="flex items-center">
                        <ChevronRight className="w-4 h-4 mx-1 opacity-50" />
                        <button
                            onClick={() => onPrefixChange(crumb.path)}
                            className={`hover:text-zinc-200 transition-colors ${idx === breadcrumbs.length - 1 ? 'text-zinc-200 font-medium' : ''}`}
                        >
                            {crumb.name}
                        </button>
                    </div>
                ))}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-12 flex-col items-center gap-4 text-muted-foreground border border-zinc-800 rounded-lg bg-card">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <p>Loading files...</p>
                </div>
            ) : files.length === 0 && virtualFolders.length === 0 ? (
                <div className="py-8">
                    <EmptyState 
                        icon={<FolderOpen className="w-12 h-12" />}
                        title={prefix ? "This folder is empty" : "No files yet"} 
                        description="Upload files to seamlessly store them in your workspace cloud."
                        action={canUpload ? { label: "Upload File", onClick: onUploadClick } : undefined}
                    />
                </div>
            ) : (
                <div className="border border-zinc-800 rounded-lg bg-card overflow-hidden">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow className="border-zinc-800 hover:bg-transparent">
                                <TableHead className="w-12 text-center">Type</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Size</TableHead>
                                <TableHead>Uploaded</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {virtualFolders.map(folderName => (
                                <TableRow 
                                    key={`folder-${folderName}`}
                                    onClick={() => onPrefixChange(`${prefix}${folderName}/`)}
                                    className="cursor-pointer border-zinc-800/50 hover:bg-muted/40 transition-colors"
                                >
                                    <TableCell className="text-center">
                                        <FolderIcon className="w-5 h-5 text-amber-500 mx-auto fill-amber-500/20" />
                                    </TableCell>
                                    <TableCell className="font-medium text-zinc-200">{folderName}/</TableCell>
                                    <TableCell className="text-zinc-500 text-sm">&mdash;</TableCell>
                                    <TableCell className="text-zinc-500 text-sm">Folder</TableCell>
                                    <TableCell className="text-right">&mdash;</TableCell>
                                </TableRow>
                            ))}
                            {files.map(file => (
                                <TableRow key={file.id} className="border-zinc-800/50 hover:bg-muted/40 transition-colors">
                                    <TableCell className="text-center">
                                        <div className="flex justify-center">{getFileIcon(file.contentType)}</div>
                                    </TableCell>
                                    <TableCell className="font-medium text-zinc-300 truncate max-w-[280px]" title={file.filename}>
                                        {file.filename}
                                    </TableCell>
                                    <TableCell className="text-zinc-400 text-sm truncate max-w-[120px]" title={file.contentType}>
                                        {formatFileSize(file.size)}
                                    </TableCell>
                                    <TableCell className="text-zinc-400 text-sm">
                                        {formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-200" onClick={(e) => { e.stopPropagation(); downloadFile(file.id); }}>
                                                <Download className="w-4 h-4" />
                                            </Button>
                                            {canDelete && (
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); setDeletingFileId(file.id); }}>
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <ConfirmDialog 
                open={!!deletingFileId}
                onOpenChange={(open) => !open && setDeletingFileId(null)}
                title="Delete File"
                description="Are you sure you want to permanently delete this file? This action cannot be undone."
                confirmLabel="Delete"
                variant="danger"
                onConfirm={() => { if (deletingFileId) deleteMutation.mutate(deletingFileId); }}
                loading={deleteMutation.isPending}
            />
        </div>
    );
}
