import {useState} from "react";
import type {Target, TargetType} from "../../model/target";
import {useTargetStore} from "../../store/targetStore";
import ModalImportDialog from "./ModalImportDialog";

interface TargetManagerProps {
    onCreateInFront?: (x: number, y: number) => void;
    isCreatingTarget?: boolean;
    onToggleCreating?: (creating: boolean) => void;
    selectedTargetType?: TargetType;
    onTargetTypeChange?: (type: TargetType) => void;
}

export const TargetManager: React.FC<TargetManagerProps> = ({
    onCreateInFront,
    isCreatingTarget: externalIsCreating,
    onToggleCreating,
    selectedTargetType: externalSelectedType,
    onTargetTypeChange
}) => {
    const {
        targets,
        updateTarget,
        removeTarget,
        selectTarget,
        selectedTargetId,
        exportTargets
    } = useTargetStore();

    const [editingTarget, setEditingTarget] = useState<Target | null>(null);
    const [editForm, setEditForm] = useState<Partial<Target>>({});
    const [showImportDialog, setShowImportDialog] = useState(false);

    const handleExportTargets = () => {
        const targetsData = exportTargets();
        const dataStr = JSON.stringify(targetsData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `targets_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };



    const isCreatingTarget = externalIsCreating !== undefined ? externalIsCreating : false;
    const selectedTargetType = externalSelectedType || 'RECT';
    const setSelectedTargetType = (type: TargetType) => {
        onTargetTypeChange?.(type);
    };

    const handleSaveEdit = () => {
        if (editingTarget) {
            updateTarget(editingTarget.id, editForm);
            setEditingTarget(null);
            setEditForm({});
        }
    };

    const handleCancelEdit = () => {
        setEditingTarget(null);
        setEditForm({});
    };

    const handleDelete = (id: string) => {
        removeTarget(id);
        if (selectedTargetId === id) {
            selectTarget(null);
        }
    };

    const handleStartEdit = (t: Target) => {
        setEditingTarget(t);
        setEditForm({...t});
    };

    const handleCreateTargetAtCamera = () => {
        if (onCreateInFront) {
            onCreateInFront(0, 0);
        }
    };

    return (
        <div style={{
            minWidth: '260px',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '16px',
            background: '#ffffff',
            height: '100%',
            maxHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxSizing: 'border-box',
            minHeight: 0,
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)'
        }}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <h3 style={{margin: 0, fontSize: 16}}>目标物管理</h3>
                <span style={{fontSize: 12, color: '#64748b'}}>管理与创建</span>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0}}>
                <h4 style={{marginTop: 0, marginBottom: '6px', fontSize: 13, color: '#334155'}}>已有目标物</h4>
                <div style={{display: 'flex', gap: '8px', marginBottom: '6px'}}>
                    <button
                        onClick={() => handleExportTargets()}
                        style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            backgroundColor: '#0ea5e9',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#0284c7'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#0ea5e9'}
                    >
                        导出为JSON
                    </button>
                    <button
                        onClick={() => setShowImportDialog(true)}
                        style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            backgroundColor: '#6366f1',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#4f46e5'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6366f1'}
                    >
                        导入JSON
                    </button>

                </div>
                <div style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '10px',
                    overflowY: 'auto',
                    background: '#f8fafc',
                    flex: 1,
                    minHeight: 0
                }}>
                    {editingTarget ? (
                        <TargetEditForm
                            editingTarget={editingTarget}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            onSave={handleSaveEdit}
                            onCancel={handleCancelEdit}
                        />
                    ) : (
                        targets.length > 0 ? (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '10px'
                            }}>
                                {targets.map(t => (
                                    <TargetItem
                                        key={t.id}
                                        target={t}
                                        isSelected={t.id === selectedTargetId}
                                        onSelect={() => selectTarget(t.id)}
                                        onEdit={() => handleStartEdit(t)}
                                        onDelete={() => handleDelete(t.id)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div style={{textAlign: 'center', color: '#94a3b8', padding: '18px', fontSize: '12px'}}>
                                暂无目标物数据
                            </div>
                        )
                    )}
                </div>
                <div style={{borderTop: '1px solid #e2e8f0', paddingTop: '12px'}}>
                    <TargetCreator
                        selectedTargetType={selectedTargetType}
                        setSelectedTargetType={setSelectedTargetType}
                        isCreatingTarget={isCreatingTarget}
                        onToggleCreating={onToggleCreating}
                        onCreateAtCamera={handleCreateTargetAtCamera}
                    />
                </div>
            </div>

            <ModalImportDialog
                isOpen={showImportDialog}
                onClose={() => setShowImportDialog(false)}
            />
        </div>
    );
};

interface TargetEditFormProps {
    editingTarget: Target;
    editForm: Partial<Target>;
    setEditForm: (form: Partial<Target>) => void;
    onSave: () => void;
    onCancel: () => void;
}

const TargetEditForm: React.FC<TargetEditFormProps> = ({
    editingTarget,
    editForm,
    setEditForm,
    onSave,
    onCancel
}) => {
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const handleNumberChange = (field: keyof Target, value: string) => {
        const num = parseFloat(value);
        let adjusted = num;
        let error = '';

        if (isNaN(num)) {
            adjusted = 0;
        } else if (num <= 0) {
            if (field === 'w' || field === 'h' || field === 'r') {
                adjusted = 1;
                error = '值必须大于0，已自动调整为1';
            }
        }

        setEditForm({...editForm, [field]: adjusted});

        if (error) {
            setFieldErrors({...fieldErrors, [field]: error});
            setTimeout(() => {
                setFieldErrors(prev => ({...prev, [field]: ''}));
            }, 3000);
        } else {
            setFieldErrors(prev => ({...prev, [field]: ''}));
        }
    };

    return (
        <div style={{
            padding: '12px',
            border: '1px solid #4ecdc4',
            borderRadius: '4px',
            background: 'rgb(255, 255, 255)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '10px'
        }}>
            <h5 style={{marginTop: 0, marginBottom: '10px', color: '#4ecdc4'}}>编辑目标物</h5>
            <div style={{display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px'}}>
                <div>
                    <label style={{fontSize: '12px', marginRight: '5px'}}>X坐标: </label>
                    <input
                        type="number"
                        value={editForm.x}
                        onChange={(e) => handleNumberChange('x', e.target.value)}
                        style={{fontSize: '12px', padding: '3px 5px', width: '80px'}}
                    />
                </div>
                <div>
                    <label style={{fontSize: '12px', marginRight: '5px'}}>Y坐标: </label>
                    <input
                        type="number"
                        value={editForm.y}
                        onChange={(e) => handleNumberChange('y', e.target.value)}
                        style={{fontSize: '12px', padding: '3px 5px', width: '80px'}}
                    />
                </div>
                {editingTarget.type === 'RECT' && (
                    <>
                        <div>
                            <label style={{fontSize: '12px', marginRight: '5px'}}>宽度: </label>
                            <input
                                type="number"
                                value={editForm.w}
                                onChange={(e) => handleNumberChange('w', e.target.value)}
                                style={{fontSize: '12px', padding: '3px 5px', width: '60px'}}
                            />
                            {fieldErrors['w'] && (
                                <div style={{fontSize: '10px', color: '#e74c3c', marginTop: '2px'}}>
                                    {fieldErrors['w']}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={{fontSize: '12px', marginRight: '5px'}}>长度: </label>
                            <input
                                type="number"
                                value={editForm.h}
                                onChange={(e) => handleNumberChange('h', e.target.value)}
                                style={{fontSize: '12px', padding: '3px 5px', width: '60px'}}
                            />
                            {fieldErrors['h'] && (
                                <div style={{fontSize: '10px', color: '#e74c3c', marginTop: '2px'}}>
                                    {fieldErrors['h']}
                                </div>
                            )}
                        </div>
                    </>
                )}
                {editingTarget.type === 'CIRCLE' && (
                    <div>
                        <label style={{fontSize: '12px', marginRight: '5px'}}>半径: </label>
                        <input
                            type="number"
                            value={editForm.r}
                            onChange={(e) => handleNumberChange('r', e.target.value)}
                            style={{fontSize: '12px', padding: '3px 5px', width: '60px'}}
                        />
                        {fieldErrors['r'] && (
                            <div style={{fontSize: '10px', color: '#e74c3c', marginTop: '2px'}}>
                                {fieldErrors['r']}
                            </div>
                        )}
                    </div>
                )}
                {editingTarget.type === 'RECT' && (
                    <div>
                        <label style={{fontSize: '12px', marginRight: '5px'}}>旋转角度: </label>
                        <input
                            type="number"
                            step="0.1"
                            value={editForm.angle || 0}
                            onChange={(e) => handleNumberChange('angle', e.target.value)}
                            style={{fontSize: '12px', padding: '3px 5px', width: '80px'}}
                        />
                        {fieldErrors['angle'] && (
                            <div style={{fontSize: '10px', color: '#e74c3c', marginTop: '2px'}}>
                                {fieldErrors['angle']}
                            </div>
                        )}
                    </div>
                )}
                <div>
                    <label style={{fontSize: '12px', marginRight: '5px'}}>颜色: </label>
                    <input
                        type="color"
                        value={editForm.color}
                        onChange={(e) => setEditForm({...editForm, color: e.target.value})}
                        style={{width: '40px', height: '20px', padding: 0, border: '1px solid #ddd'}}
                    />
                </div>
                <div style={{display: 'flex', gap: '8px', marginTop: '10px'}}>
                    <button onClick={onSave} style={{
                        padding: '5px 10px',
                        fontSize: '12px',
                        backgroundColor: '#4ecdc4',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                    }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#45b7d1'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#4ecdc4'}>
                        保存修改
                    </button>
                    <button onClick={onCancel} style={{
                        padding: '5px 10px',
                        fontSize: '12px',
                        backgroundColor: '#95a5a6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                    }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#7f8c8d'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#95a5a6'}>
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
};

interface TargetItemProps {
    target: Target;
    isSelected: boolean;
    onSelect: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

const TargetItem: React.FC<TargetItemProps> = ({
    target,
    isSelected,
    onSelect,
    onEdit,
    onDelete
}) => {
    return (
        <div
            style={{
                border: `1px solid ${isSelected ? '#38bdf8' : '#e2e8f0'}`,
                borderRadius: '10px',
                padding: '8px',
                background: isSelected ? 'rgba(56, 189, 248, 0.12)' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '88px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 8px 18px rgba(15, 23, 42, 0.12)';
                e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
            }}
            onClick={onSelect}
        >
            <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                <div style={{width: '12px', height: '12px', backgroundColor: target.color, borderRadius: '4px', border: '1px solid #e2e8f0'}} />
                <span style={{fontSize: '11px', color: '#334155', fontWeight: 600}}>
                    {target.type === 'RECT' ? '矩形' : '圆形'}
                </span>
            </div>

            <div style={{fontSize: '10px', color: '#94a3b8', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: '1.2'}}>
                ID: {target.id}
            </div>

            <div style={{fontSize: '11px', color: '#475569', lineHeight: '1.2'}}>
                位置: ({Math.floor(target.x)}, {Math.floor(target.y)})
            </div>

            <div style={{fontSize: '11px', color: '#475569', lineHeight: '1.2'}}>
                {target.type === 'RECT' ? `尺寸: ${target.w}x${target.h}` : `半径: ${target.r}`}
            </div>

            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px'}}>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                    style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        backgroundColor: '#f59e0b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#d97706'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f59e0b'}
                >
                    编辑
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    style={{
                        padding: '3px 8px',
                        fontSize: '10px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ef4444'}
                >
                    删除
                </button>
            </div>
        </div>
    );
};

interface TargetCreatorProps {
    selectedTargetType: TargetType;
    setSelectedTargetType: (type: TargetType) => void;
    isCreatingTarget: boolean;
    onToggleCreating?: (creating: boolean) => void;
    onCreateAtCamera: () => void;
}

const TargetCreator: React.FC<TargetCreatorProps> = ({
    selectedTargetType,
    setSelectedTargetType,
    isCreatingTarget,
    onToggleCreating,
    onCreateAtCamera
}) => {
    return (
        <div style={{
            padding: 0,
            border: 'none',
            borderRadius: 0,
            background: 'transparent',
            width: '100%',
            maxWidth: '100%'
        }}>
            <h3 style={{marginTop: 0, fontSize: '14px', textAlign: 'left', color: '#334155'}}>创建目标物</h3>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                alignItems: 'stretch'
            }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <label style={{fontSize: 12, color: '#475569'}}>选择类型</label>
                    <select
                        value={selectedTargetType}
                        onChange={(e) => setSelectedTargetType(e.target.value as TargetType)}
                        style={{padding: '6px 8px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', flex: 1}}
                    >
                        <option value="RECT">矩形</option>
                        <option value="CIRCLE">圆形</option>
                    </select>
                </div>
                <div style={{display: 'flex', gap: '10px'}}>
                    <button
                        onClick={() => onToggleCreating?.(!isCreatingTarget)}
                        style={{
                            padding: '8px 12px',
                            fontSize: '12px',
                            backgroundColor: isCreatingTarget ? '#ff6b6b' : '#4ecdc4',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        {isCreatingTarget ? '取消' : '开始创建'}
                    </button>
                    <button
                        onClick={onCreateAtCamera}
                        style={{
                            padding: '8px 12px',
                            fontSize: '12px',
                            backgroundColor: '#45b7d1',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        在摄像头下创建
                    </button>
                </div>
                <div style={{fontSize: '11px', color: '#64748b', textAlign: 'center'}}>
                    状态: {isCreatingTarget ? '就绪 - 点击画布创建' : '未激活'}
                </div>
            </div>
        </div>
    );
};

export default TargetManager;
