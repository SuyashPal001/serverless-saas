import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance } from 'tippy.js'
import { MentionList } from './MentionList'
import type { MentionItem } from '@/hooks/use-mention-suggestions'

export function createMentionSuggestion(
    getItems: () => MentionItem[],
) {
    return {
        items: ({ query }: { query: string }) => {
            const all = getItems()
            const q = query.toLowerCase()
            return (q ? all.filter(i => i.name.toLowerCase().includes(q)) : all).slice(0, 6)
        },

        render: () => {
            let component: ReactRenderer
            let popup: Instance[]

            return {
                onStart: (props: any) => {
                    component = new ReactRenderer(MentionList, {
                        props,
                        editor: props.editor,
                    })

                    if (!props.clientRect) return

                    popup = tippy('body', {
                        getReferenceClientRect: props.clientRect,
                        appendTo: () => document.body,
                        content: component.element,
                        showOnCreate: true,
                        interactive: true,
                        trigger: 'manual',
                        placement: 'bottom-start',
                        theme: 'none',
                        arrow: false,
                        offset: [0, 4],
                        zIndex: 9999,
                    }) as Instance[]
                },

                onUpdate: (props: any) => {
                    component.updateProps(props)
                    if (!props.clientRect) return
                    popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
                },

                onKeyDown: (props: any) => {
                    if (props.event.key === 'Escape') {
                        popup?.[0]?.hide()
                        return true
                    }
                    return (component.ref as any)?.onKeyDown(props) ?? false
                },

                onExit: () => {
                    popup?.[0]?.destroy()
                    component?.destroy()
                },
            }
        },
    }
}
