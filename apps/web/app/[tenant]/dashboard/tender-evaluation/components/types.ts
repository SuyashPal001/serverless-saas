export interface BidderTechnicalScore {
    bidderId: string;
    technicalScore: number;
    breakdown: Array<{
        clauseNo: string;
        weight: number;
        status: string;
        points: number;
    }>;
}
