import React from 'react';
import { format, isPast, isToday } from 'date-fns';
import {
  ClockIcon,
  MapPinIcon,
  PhoneIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import type { Appointment } from '@/lib/api';

interface AppointmentCardProps {
  appointment: Appointment;
  compact?: boolean;
}

export default function AppointmentCard({ appointment, compact = false }: AppointmentCardProps) {
  const scheduledDate = new Date(appointment.scheduled_time);
  const past = isPast(new Date(appointment.end_time));
  const today = isToday(scheduledDate);

  const timeStr = format(scheduledDate, 'h:mm a');
  const endTimeStr = format(new Date(appointment.end_time), 'h:mm a');
  const dateStr = today ? 'Today' : format(scheduledDate, 'EEE, MMM d');

  return (
    <div
      className={clsx(
        'card p-4 transition-opacity',
        past && 'opacity-60',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={clsx(
                'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                today && !past
                  ? 'bg-green-100 text-green-700'
                  : past
                  ? 'bg-gray-100 text-gray-500'
                  : 'bg-brand-100 text-brand-700'
              )}
            >
              {today && !past ? 'Today' : past ? 'Completed' : dateStr}
            </span>
            {appointment.confirmed && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200">
                Confirmed
              </span>
            )}
          </div>

          <p className="text-sm font-semibold text-gray-900 truncate">
            {appointment.customer_name}
          </p>

          {!compact && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <WrenchScrewdriverIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <span className="truncate">{appointment.service_type}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ClockIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <span>
                  {timeStr}–{endTimeStr}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPinIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <span className="truncate">{appointment.address}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <PhoneIcon className="w-4 h-4 flex-shrink-0 text-gray-400" />
                <a
                  href={`tel:${appointment.customer_phone}`}
                  className="text-brand-600 hover:underline"
                >
                  {appointment.customer_phone}
                </a>
              </div>
              {appointment.price_range && (
                <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded px-2 py-1">
                  Quoted range: {appointment.price_range}
                </p>
              )}
            </div>
          )}

          {compact && (
            <p className="text-xs text-gray-500 mt-0.5">
              {timeStr} · {appointment.service_type}
            </p>
          )}
        </div>

        {compact && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs font-medium text-gray-700">{timeStr}</p>
          </div>
        )}
      </div>
    </div>
  );
}
