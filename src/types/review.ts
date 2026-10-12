/**
 * One review as the provider page shows it, whatever it came from (Google
 * Places, or the Doctoralia reviews we store). Field names follow Google's
 * because the card was written for those first.
 */
export interface ReviewItem {
    author_name: string;
    rating: number;
    text: string;
    relative_time_description: string;
    profile_photo_url?: string;
    /** `text` is a translation into the visitor's language, not what the patient wrote. */
    translated?: boolean;
}
