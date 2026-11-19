/** A hotel card's shape while hotels load, in the shared shimmer (.skeleton). */
export function HotelSkeleton() {
    return (
        <div className="ms-hotel is-skeleton" aria-hidden="true">
            <div className="ms-hotel-photo skeleton" />
            <div className="ms-hotel-body">
                <div className="ms-hotel-line skeleton" style={{ width: '75%' }} />
                <div className="ms-hotel-line skeleton" style={{ width: '45%' }} />
                <div className="ms-hotel-line skeleton" style={{ width: '90%' }} />
            </div>
        </div>
    );
}
