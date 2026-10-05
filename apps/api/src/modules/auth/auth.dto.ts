import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'long@example.com', maxLength: 254 }) email!: string;
  @ApiProperty({ minLength: 1, maxLength: 128, format: 'password' }) password!: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty({ example: 'Long Nguyen', minLength: 2, maxLength: 80 }) name!: string;
  @ApiProperty({ minLength: 12, maxLength: 128, format: 'password' }) declare password: string;
}

export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
class SessionDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty({ type: PublicUserDto }) user!: PublicUserDto;
}
export class SessionResponseDto {
  @ApiProperty({ type: SessionDto }) data!: SessionDto;
  @ApiProperty({ type: Object, example: {} }) meta!: Record<string, unknown>;
}
export class UserResponseDto {
  @ApiProperty({ type: PublicUserDto }) data!: PublicUserDto;
  @ApiProperty({ type: Object, example: {} }) meta!: Record<string, unknown>;
}
