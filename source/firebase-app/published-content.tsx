import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './account';
import { useUi } from './ui';
/** Plain text only. Published content never executes HTML or scripts. */
export function usePublishedContent(slug: string) {
    const [content, setContent] = useState<Record<string, string> | null>(null);
    useEffect(() => {
        let current = true;
        setContent(null);
        void getDoc(doc(db, 'orinPublicContent', slug)).then(s => {
            const d = s.data();
            if (current && d?.status === 'published' && typeof d.bodyAr === 'string' && typeof d.bodyEn === 'string')
                setContent(d as Record<string, string>);
        }).catch(() => { });
        return () => { current = false; };
    }, [slug]);
    return content;
}
export function PublishedBanner() { const content = usePublishedContent('banner'), { t } = useUi(); return content ? <div className="orin-welcome" role="status"><strong>{t(content.titleAr, content.titleEn)}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{t(content.bodyAr, content.bodyEn)}</p></div> : null; }
