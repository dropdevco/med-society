import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Whether this user owns at least one listing as an owner (front-desk staff
 * do not count), which is what makes them a clinician to the forums (the same
 * question `public.is_clinician()` answers for RLS). One head-only count, so the navbar can ask on every page without
 * pulling the listings themselves; pages that need those use useMyClinic.
 */
export function useIsClinician(userId: string | null) {
    const [state, setState] = useState<{ userId: string | null; value: boolean }>({ userId: null, value: false });

    useEffect(() => {
        if (!supabase || !userId) return;
        let cancelled = false;
        void supabase
            .from('provider_owners')
            .select('provider_id', { count: 'exact', head: true })
            .eq('role', 'owner')
            .then(({ count }) => { if (!cancelled) setState({ userId, value: (count ?? 0) > 0 }); });
        return () => { cancelled = true; };
    }, [userId]);

    // Derived rather than reset in the effect, so signing out answers `false`
    // on the same render instead of one render later.
    return {
        isClinician: !!userId && state.userId === userId && state.value,
        // Signed in but not answered yet: a gate must wait, not refuse.
        loading: !!supabase && !!userId && state.userId !== userId,
    };
}
